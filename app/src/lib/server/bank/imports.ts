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
import { chunk, rowsPerStatement, runBatch, selectInChunks } from '../db/batch';
import {
	auditLog,
	bankImports,
	bankTransactions,
	expenses,
	otherBookingKinds,
	otherBookings,
	payments
} from '../db/schema';
import { otherBookingKindLabels } from '../../labels';
import { expenseSummary } from '../expenses';
import { contraAccountLabel, listContraAccounts, type ContraAccount } from './contra-accounts';
import { leaseLabel, listLeases } from '../leases';
import { getBankAccount } from './accounts';
import { listConfirmedRules } from './rules';
import { assertQuota } from '../quotas';

// The CSV import: every row of the file is new, a duplicate (its fingerprint is already in the
// bank account), a rule hit (a confirmed rule books it on import: incoming rent to a lease, or
// either direction to a Gegenkonto) or invalid.
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
	/** The Gegenkonto a rule hit is booked to, instead of a lease. */
	contraAccountId: string | null;
	/** The lease or Gegenkonto of a rule hit. */
	targetLabel: string | null;
};

export type ImportCounts = {
	total: number;
	new: number;
	duplicates: number;
	rules: number;
	invalid: number;
};

export type ImportPreview = { rows: PreviewRow[]; counts: ImportCounts };

type AnalyzedRow = PreviewRow & {
	fingerprinted: FingerprintedRow | null;
	contraAccount: ContraAccount | null;
};

/**
 * Fixed number of queries: the bank account, the fingerprints (per 90), the rules, the leases,
 * the Gegenkonten.
 */
async function analyze(
	db: Database,
	accountId: string,
	bankAccountId: string,
	results: RowResult[]
): Promise<AnalyzedRow[] | undefined> {
	if (!(await getBankAccount(db, accountId, bankAccountId))) return undefined;

	const valid = results.flatMap((result, index) => (result.ok ? [{ index, row: result.row }] : []));
	const fingerprinted = await fingerprintRows(valid.map((entry) => entry.row));
	const existingRows = await selectInChunks(
		fingerprinted.map((row) => row.fingerprint),
		(fingerprints) =>
			db
				.select({ fingerprint: bankTransactions.fingerprint, status: bankTransactions.status })
				.from(bankTransactions)
				.where(
					and(
						eq(bankTransactions.accountId, accountId),
						eq(bankTransactions.bankAccountId, bankAccountId),
						inArray(bankTransactions.fingerprint, fingerprints)
					)
				)
	);
	const existing = new Map(existingRows.map((row) => [row.fingerprint, row.status]));
	const [rules, leases, contraAccounts] = await Promise.all([
		listConfirmedRules(db, accountId),
		listLeases(db, accountId),
		listContraAccounts(db, accountId)
	]);
	const labels = new Map(leases.map((lease) => [lease.id, leaseLabel(lease)]));
	const contraById = new Map(contraAccounts.map((account) => [account.id, account]));
	const otherKinds = new Set<string>(otherBookingKinds);
	const none = { leaseId: null, contraAccountId: null, targetLabel: null, contraAccount: null };

	const byIndex = new Map(valid.map((entry, position) => [entry.index, fingerprinted[position]]));
	return results.map((result, index): AnalyzedRow => {
		const row = byIndex.get(index);
		if (!result.ok || !row) {
			const reason = result.ok ? null : result.reason;
			return { index, status: 'invalid', row: null, reason, ...none, fingerprinted: null };
		}
		if (existing.has(row.fingerprint)) {
			// An ignored line stays ignored; the preview says where it can be opened again.
			const reason = existing.get(row.fingerprint) === 'ignored' ? 'Ignoriert' : null;
			return { index, status: 'duplicate', row, reason, ...none, fingerprinted: row };
		}
		const rule = applyRules(rules, row);
		if (rule?.leaseId && labels.has(rule.leaseId)) {
			return {
				index,
				status: 'rule',
				row,
				reason: null,
				...none,
				leaseId: rule.leaseId,
				targetLabel: labels.get(rule.leaseId) ?? null,
				fingerprinted: row
			};
		}
		const contra = rule?.contraAccountId ? contraById.get(rule.contraAccountId) : undefined;
		// Only an expense (with its category) or an other booking takes a Gegenkonto rule: rent and
		// deposits go to a lease, and a lease rule books them there.
		if (
			contra &&
			(otherKinds.has(contra.kind) || (contra.kind === 'expense' && contra.expenseCategory))
		) {
			return {
				index,
				status: 'rule',
				row,
				reason: null,
				leaseId: null,
				contraAccountId: contra.id,
				targetLabel: contraAccountLabel(contra),
				contraAccount: contra,
				fingerprinted: row
			};
		}
		return { index, status: 'new', row, reason: null, ...none, fingerprinted: row };
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
		const { fingerprinted: _, contraAccount: __, ...row } = entry;
		void _;
		void __;
		return row;
	});
	return { rows, counts: countRows(rows) };
}

export type ImportResult = ImportCounts & { importId: string; imported: number; assigned: number };

/**
 * Writes the import, its new transactions, the payments of the rule hits and the audit entries
 * in one batch, bulk inserts split per 100 parameters. Undefined when the bank account is not in
 * the account.
 *
 * When the same file is committed twice at once, both requests see the rows as new; the unique
 * fingerprint refuses the second batch, which then runs once more and reports the rows as
 * duplicates.
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
	const expenseRows: (typeof expenses.$inferInsert)[] = [];
	const otherRows: (typeof otherBookings.$inferInsert)[] = [];
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
		const contra = entry.status === 'rule' ? entry.contraAccount : null;
		if (contra) {
			const who = row.counterpartName || 'ohne Namen';
			const label = `Umsatz ${formatCents(row.amount)} vom ${formatDate(row.bookingDate)} (${who})`;
			if (contra.kind === 'expense' && contra.expenseCategory) {
				const expense = {
					id: crypto.randomUUID(),
					accountId,
					propertyId: contra.propertyId,
					unitId: null,
					date: row.bookingDate,
					amount: -row.amount,
					category: contra.expenseCategory,
					description: (row.purpose || row.counterpartName || contra.name).slice(0, 200),
					contraAccountId: contra.id,
					bankTransactionId: id
				};
				expenseRows.push(expense);
				auditRows.push({
					accountId,
					userId: context.userId,
					entity: 'bankTransaction',
					entityId: id,
					action: 'assign',
					summary: `${label} als ${expenseSummary(expense)} per Regel zugeordnet`
				});
			} else if (
				contra.kind === 'capital_income' ||
				contra.kind === 'private' ||
				contra.kind === 'other_income'
			) {
				otherRows.push({
					id: crypto.randomUUID(),
					accountId,
					kind: contra.kind,
					contraAccountId: contra.id,
					propertyId: contra.propertyId,
					date: row.bookingDate,
					amount: row.amount,
					description: row.purpose.slice(0, 200),
					bankTransactionId: id
				});
				auditRows.push({
					accountId,
					userId: context.userId,
					entity: 'bankTransaction',
					entityId: id,
					action: 'assign',
					summary: `${label} als ${otherBookingKindLabels[contra.kind]} per Regel gebucht`
				});
			}
		}
	}

	const imported = counts.new + counts.rules;
	await assertQuota(db, accountId, 'bankTransactions', transactionRows.length);
	await assertQuota(db, accountId, 'payments', paymentRows.length);
	await assertQuota(db, accountId, 'expenses', expenseRows.length);
	await assertQuota(db, accountId, 'otherBookings', otherRows.length);
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
				db.insert(bankTransactions).values(rows)
			),
			...chunk(paymentRows, rowsPerStatement(payments)).map((rows) =>
				db.insert(payments).values(rows)
			),
			...chunk(expenseRows, rowsPerStatement(expenses)).map((rows) =>
				db.insert(expenses).values(rows)
			),
			...chunk(otherRows, rowsPerStatement(otherBookings)).map((rows) =>
				db.insert(otherBookings).values(rows)
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
	const found = await selectInChunks(
		rows.map((row) => row.fingerprint),
		(fingerprints) =>
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
	);
	return found.length > 0;
}
