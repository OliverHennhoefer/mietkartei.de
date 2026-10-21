import { and, eq, inArray } from 'drizzle-orm';
import {
	applyRules,
	fingerprintRows,
	type BankRow,
	type FingerprintedRow,
	type RowResult
} from '../../domain/bank-matching';
import { formatDate } from '../../dates';
import { pluralize } from '../../format';
import { formatCents } from '../../money';
import { auditEntry, type AuditContext } from '../audit';
import type { Database } from '../db';
import { chunk, chunkIds, rowsPerStatement, runBatch } from '../db/batch';
import { auditLog, bankImports, bankTransactions, payments } from '../db/schema';
import { leaseLabel, listLeases } from '../leases';
import { getBankAccount } from './accounts';
import { listConfirmedRules } from './rules';
import { assertQuota } from '../quotas';

// The CSV import: every row of the file is new, a duplicate (its fingerprint is already in the
// bank account), a rule hit (a confirmed rule assigns the incoming amount on import) or invalid.
// The preview and the commit run the same analysis, so what the landlord saw is what happens.

export type PreviewStatus = 'new' | 'duplicate' | 'rule' | 'invalid';

export type PreviewRow = {
	/** Position in the file, 0-based, so the page can number the rows. */
	index: number;
	status: PreviewStatus;
	row: BankRow | null;
	/** Why the row is invalid, or which rule hit. */
	reason: string | null;
	leaseId: string | null;
	leaseLabel: string | null;
};

export type ImportCounts = {
	total: number;
	new: number;
	duplicates: number;
	rules: number;
	invalid: number;
};

export type ImportPreview = { rows: PreviewRow[]; counts: ImportCounts };

type AnalyzedRow = PreviewRow & { fingerprinted: FingerprintedRow | null };

/** Fixed number of queries: the bank account, the fingerprints (per 90), the rules, the leases. */
async function analyze(
	db: Database,
	accountId: string,
	bankAccountId: string,
	results: RowResult[]
): Promise<AnalyzedRow[] | undefined> {
	if (!(await getBankAccount(db, accountId, bankAccountId))) return undefined;

	const valid = results.flatMap((result, index) => (result.ok ? [{ index, row: result.row }] : []));
	const fingerprinted = await fingerprintRows(valid.map((entry) => entry.row));
	const existing = new Set(
		(
			await Promise.all(
				chunkIds(fingerprinted.map((row) => row.fingerprint)).map((fingerprints) =>
					db
						.select({ fingerprint: bankTransactions.fingerprint })
						.from(bankTransactions)
						.where(
							and(
								eq(bankTransactions.accountId, accountId),
								eq(bankTransactions.bankAccountId, bankAccountId),
								inArray(bankTransactions.fingerprint, fingerprints)
							)
						)
				)
			)
		)
			.flat()
			.map((row) => row.fingerprint)
	);
	const [rules, leases] = await Promise.all([
		listConfirmedRules(db, accountId),
		listLeases(db, accountId)
	]);
	const labels = new Map(leases.map((lease) => [lease.id, leaseLabel(lease)]));

	const byIndex = new Map(valid.map((entry, position) => [entry.index, fingerprinted[position]]));
	return results.map((result, index): AnalyzedRow => {
		const row = byIndex.get(index);
		if (!result.ok || !row) {
			const reason = result.ok ? null : result.reason;
			return {
				index,
				status: 'invalid',
				row: null,
				reason,
				leaseId: null,
				leaseLabel: null,
				fingerprinted: null
			};
		}
		if (existing.has(row.fingerprint)) {
			return {
				index,
				status: 'duplicate',
				row,
				reason: null,
				leaseId: null,
				leaseLabel: null,
				fingerprinted: row
			};
		}
		const leaseId = applyRules(rules, row);
		if (leaseId && labels.has(leaseId)) {
			return {
				index,
				status: 'rule',
				row,
				reason: null,
				leaseId,
				leaseLabel: labels.get(leaseId) ?? null,
				fingerprinted: row
			};
		}
		return {
			index,
			status: 'new',
			row,
			reason: null,
			leaseId: null,
			leaseLabel: null,
			fingerprinted: row
		};
	});
}

function countRows(rows: readonly PreviewRow[]): ImportCounts {
	const counts: ImportCounts = { total: rows.length, new: 0, duplicates: 0, rules: 0, invalid: 0 };
	for (const row of rows) {
		if (row.status === 'new') counts.new += 1;
		else if (row.status === 'duplicate') counts.duplicates += 1;
		else if (row.status === 'rule') counts.rules += 1;
		else counts.invalid += 1;
	}
	return counts;
}

/** What the import would do; undefined when the bank account is not in the account. */
export async function previewImport(
	db: Database,
	accountId: string,
	bankAccountId: string,
	results: RowResult[]
): Promise<ImportPreview | undefined> {
	const analyzed = await analyze(db, accountId, bankAccountId, results);
	if (!analyzed) return undefined;
	const rows = analyzed.map((entry): PreviewRow => {
		const { fingerprinted: _, ...row } = entry;
		void _;
		return row;
	});
	return { rows, counts: countRows(rows) };
}

export type ImportResult = ImportCounts & { importId: string; imported: number; assigned: number };

/**
 * Writes the import, its new transactions (onConflictDoNothing on the fingerprint, so a file
 * imported twice at once still adds nothing twice), the payments of the rule hits and the audit
 * entries in one batch, bulk inserts split per 100 parameters. Undefined when the bank account is
 * not in the account.
 *
 * When the same file is committed twice at once, both requests see the rows as new; the second
 * batch skips the transactions but its payments point at ids that were never stored, so the batch
 * fails. Then the import runs once more and reports the rows as duplicates.
 */
export async function commitImport(
	db: Database,
	context: AuditContext,
	bankAccountId: string,
	fileName: string,
	results: RowResult[]
): Promise<ImportResult | undefined> {
	const first = await commitOnce(db, context, bankAccountId, fileName, results);
	if (first !== 'conflict') return first;
	const second = await commitOnce(db, context, bankAccountId, fileName, results);
	if (second === 'conflict') throw new Error('bank import conflicted twice');
	return second;
}

async function commitOnce(
	db: Database,
	context: AuditContext,
	bankAccountId: string,
	fileName: string,
	results: RowResult[]
): Promise<ImportResult | undefined | 'conflict'> {
	const { accountId } = context;
	const analyzed = await analyze(db, accountId, bankAccountId, results);
	if (!analyzed) return undefined;
	const counts = countRows(analyzed);
	const importId = crypto.randomUUID();

	const transactionRows: (typeof bankTransactions.$inferInsert)[] = [];
	const paymentRows: (typeof payments.$inferInsert)[] = [];
	const auditRows: (typeof auditLog.$inferInsert)[] = [];
	for (const entry of analyzed) {
		const row = entry.fingerprinted;
		if (!row || entry.status === 'duplicate') continue;
		const id = crypto.randomUUID();
		transactionRows.push({
			id,
			accountId,
			bankAccountId,
			importId,
			bookingDate: row.bookingDate,
			valueDate: row.valueDate,
			amount: row.amount,
			counterpartName: row.counterpartName,
			counterpartIban: row.counterpartIban,
			purpose: row.purpose,
			fingerprint: row.fingerprint,
			occurrence: row.occurrence,
			externalId: row.externalId,
			status: entry.status === 'rule' ? 'matched' : 'unmatched'
		});
		if (entry.status === 'rule' && entry.leaseId) {
			paymentRows.push({
				id: crypto.randomUUID(),
				accountId,
				leaseId: entry.leaseId,
				date: row.bookingDate,
				amount: row.amount,
				source: 'bank',
				bankTransactionId: id,
				note: row.purpose || null
			});
			auditRows.push({
				accountId,
				userId: context.userId,
				entity: 'lease',
				entityId: entry.leaseId,
				action: 'assign',
				summary: `Zahlung ${formatCents(row.amount)} vom ${formatDate(row.bookingDate)} (${row.counterpartName || 'ohne Namen'}) per Regel zugeordnet`
			});
		}
	}

	const imported = counts.new + counts.rules;
	await assertQuota(db, accountId, 'bankTransactions', transactionRows.length);
	await assertQuota(db, accountId, 'payments', paymentRows.length);
	try {
		await runBatch(db, [
			db.insert(bankImports).values({
				id: importId,
				accountId,
				bankAccountId,
				fileName,
				rowCount: counts.total,
				importedCount: imported,
				duplicateCount: counts.duplicates,
				importedBy: context.userId
			}),
			...chunk(transactionRows, rowsPerStatement(bankTransactions)).map((rows) =>
				db.insert(bankTransactions).values(rows).onConflictDoNothing()
			),
			...chunk(paymentRows, rowsPerStatement(payments)).map((rows) =>
				db.insert(payments).values(rows)
			),
			...chunk(auditRows, rowsPerStatement(auditLog)).map((rows) =>
				db.insert(auditLog).values(rows)
			),
			auditEntry(
				db,
				context,
				'bankImport',
				importId,
				'import',
				`Kontoauszug „${fileName}“ importiert: ${pluralize(imported, 'neuer Umsatz', 'neue Umsätze')}, ${pluralize(counts.duplicates, 'Duplikat', 'Duplikate')}, ${counts.rules} per Regel zugeordnet`
			)
		]);
	} catch (cause) {
		if (await anyStored(db, accountId, bankAccountId, transactionRows)) return 'conflict';
		throw cause;
	}
	return { ...counts, importId, imported, assigned: counts.rules };
}

/** Whether another request stored one of these rows (by fingerprint) in the meantime. */
async function anyStored(
	db: Database,
	accountId: string,
	bankAccountId: string,
	rows: readonly { fingerprint: string }[]
): Promise<boolean> {
	const found = await Promise.all(
		chunkIds(rows.map((row) => row.fingerprint)).map((fingerprints) =>
			db
				.select({ id: bankTransactions.id })
				.from(bankTransactions)
				.where(
					and(
						eq(bankTransactions.accountId, accountId),
						eq(bankTransactions.bankAccountId, bankAccountId),
						inArray(bankTransactions.fingerprint, fingerprints)
					)
				)
				.limit(1)
		)
	);
	return found.some((group) => group.length > 0);
}
