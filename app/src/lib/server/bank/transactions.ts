import { and, asc, count, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { formatDate } from '../../dates';
import { rememberStep, type LeaseHints } from '../../domain/bank-matching';
import type { AssignmentInput } from '../../forms/bank';
import type { ExpenseAssignmentInput } from '../../forms/expenses';
import { formatCents } from '../../money';
import { auditEntry, type AuditContext } from '../audit';
import type { Database } from '../db';
import { chunkIds, runBatch } from '../db/batch';
import {
	bankAccounts,
	bankTransactions,
	depositTransactions,
	expenses,
	leases,
	payments,
	type BankTransactionStatus
} from '../db/schema';
import {
	expenseScopeValue,
	expenseSummary,
	knownServiceProvider,
	resolveScope,
	scopeLabels
} from '../expenses';
import { paymentEntry } from '../ledger';
import { leaseLabel, type LeaseSummary } from '../leases';
import { listRules, ruleEntry, unconfirmEntries } from './rules';
import { assertQuota, QUOTAS, usage } from '../quotas';

// Umsätze: the imported statement lines and their assignment to leases or as an expense. `matched`
// means a payment, a deposit movement or an expense references the transaction; undo deletes
// those and reopens it.

export type BankTransaction = typeof bankTransactions.$inferSelect;
type Expense = typeof expenses.$inferSelect;
export type TransactionRow = BankTransaction & { bankAccountName: string };

export type TransactionFilter = {
	status: BankTransactionStatus | 'all';
	bankAccountId?: string | null;
	/** Only this one transaction (the link from a payment or deposit movement), whatever its status. */
	transactionId?: string | null;
	/** How many rows the page shows at most; one more is fetched to know whether there are more. */
	limit?: number;
};

const DEFAULT_LIMIT = 200;

/** Newest first; identical lines of one day in the order they stood in the file. */
export async function listTransactions(
	db: Database,
	accountId: string,
	filter: TransactionFilter
): Promise<{ rows: TransactionRow[]; more: boolean }> {
	const limit = filter.limit ?? DEFAULT_LIMIT;
	const rows = await db
		.select({ transaction: bankTransactions, bankAccountName: bankAccounts.name })
		.from(bankTransactions)
		.innerJoin(bankAccounts, eq(bankTransactions.bankAccountId, bankAccounts.id))
		.where(
			and(
				eq(bankTransactions.accountId, accountId),
				filter.status === 'all' ? undefined : eq(bankTransactions.status, filter.status),
				filter.bankAccountId ? eq(bankTransactions.bankAccountId, filter.bankAccountId) : undefined,
				filter.transactionId ? eq(bankTransactions.id, filter.transactionId) : undefined
			)
		)
		.orderBy(
			desc(bankTransactions.bookingDate),
			desc(bankTransactions.createdAt),
			asc(bankTransactions.occurrence)
		)
		.limit(limit + 1);
	return {
		rows: rows
			.slice(0, limit)
			.map((row) => ({ ...row.transaction, bankAccountName: row.bankAccountName })),
		more: rows.length > limit
	};
}

export async function countUnmatched(db: Database, accountId: string): Promise<number> {
	const [row] = await db
		.select({ value: count() })
		.from(bankTransactions)
		.where(
			and(eq(bankTransactions.accountId, accountId), eq(bankTransactions.status, 'unmatched'))
		);
	return row.value;
}

export async function getTransaction(
	db: Database,
	accountId: string,
	transactionId: string
): Promise<BankTransaction | undefined> {
	const [row] = await db
		.select()
		.from(bankTransactions)
		.where(and(eq(bankTransactions.accountId, accountId), eq(bankTransactions.id, transactionId)));
	return row;
}

export type Assignment =
	| { kind: 'rent' | 'deposit'; id: string; leaseId: string; amount: number }
	| { kind: 'expense'; id: string; amount: number; category: Expense['category']; scope: string };

/**
 * The payments, deposit movements and expenses of the given transactions: three queries per 90
 * ids and two for the expenses' labels.
 */
export async function listAssignments(
	db: Database,
	accountId: string,
	transactionIds: readonly string[]
): Promise<Map<string, Assignment[]>> {
	const result = new Map<string, Assignment[]>();
	const add = (transactionId: string | null, assignment: Assignment) => {
		if (!transactionId) return;
		const list = result.get(transactionId);
		if (list) list.push(assignment);
		else result.set(transactionId, [assignment]);
	};
	const label = await scopeLabels(db, accountId);
	await Promise.all(
		chunkIds([...new Set(transactionIds)]).map(async (ids) => {
			const [paymentRows, depositRows, expenseRows] = await Promise.all([
				db
					.select({
						id: payments.id,
						leaseId: payments.leaseId,
						amount: payments.amount,
						bankTransactionId: payments.bankTransactionId
					})
					.from(payments)
					.where(and(eq(payments.accountId, accountId), inArray(payments.bankTransactionId, ids)))
					.orderBy(asc(payments.createdAt)),
				db
					.select({
						id: depositTransactions.id,
						leaseId: depositTransactions.leaseId,
						amount: depositTransactions.amount,
						bankTransactionId: depositTransactions.bankTransactionId
					})
					.from(depositTransactions)
					.where(
						and(
							eq(depositTransactions.accountId, accountId),
							inArray(depositTransactions.bankTransactionId, ids)
						)
					),
				db
					.select()
					.from(expenses)
					.where(and(eq(expenses.accountId, accountId), inArray(expenses.bankTransactionId, ids)))
			]);
			for (const row of paymentRows) add(row.bankTransactionId, { kind: 'rent', ...row });
			for (const row of depositRows) add(row.bankTransactionId, { kind: 'deposit', ...row });
			for (const row of expenseRows) {
				add(row.bankTransactionId, {
					kind: 'expense',
					id: row.id,
					amount: row.amount,
					category: row.category,
					scope: label(row)
				});
			}
		})
	);
	return result;
}

/**
 * Which lease the money from each counterpart IBAN went to last: the IBANs of assigned
 * transactions mapped to the lease of their payment or deposit movement. Two queries.
 */
export async function leaseByIban(db: Database, accountId: string): Promise<Map<string, string>> {
	const [paymentRows, depositRows] = await Promise.all([
		db
			.select({
				iban: bankTransactions.counterpartIban,
				leaseId: payments.leaseId,
				createdAt: payments.createdAt
			})
			.from(payments)
			.innerJoin(bankTransactions, eq(payments.bankTransactionId, bankTransactions.id))
			.where(and(eq(payments.accountId, accountId), isNotNull(bankTransactions.counterpartIban))),
		db
			.select({
				iban: bankTransactions.counterpartIban,
				leaseId: depositTransactions.leaseId,
				createdAt: depositTransactions.createdAt
			})
			.from(depositTransactions)
			.innerJoin(bankTransactions, eq(depositTransactions.bankTransactionId, bankTransactions.id))
			.where(
				and(
					eq(depositTransactions.accountId, accountId),
					isNotNull(bankTransactions.counterpartIban)
				)
			)
	]);
	const result = new Map<string, string>();
	const rows = [...paymentRows, ...depositRows].sort(
		(a, b) => a.createdAt.getTime() - b.createdAt.getTime()
	);
	for (const row of rows) if (row.iban) result.set(row.iban, row.leaseId);
	return result;
}

/** What an earlier expense from the same counterpart was booked as: the expense form's preset. */
export type ExpensePreset = {
	category: Expense['category'];
	scope: string;
	description: string;
	/** '' when unknown. */
	serviceProviderId: string;
};

/**
 * The last expense booked from each counterpart, by IBAN and by name (lowercased), so a payee
 * booked once (Stadtwerke, the insurer) comes back with the same category, scope, description and
 * Dienstleister.
 * One query.
 */
export async function expenseByCounterpart(
	db: Database,
	accountId: string
): Promise<{ byIban: Map<string, ExpensePreset>; byName: Map<string, ExpensePreset> }> {
	const rows = await db
		.select({
			iban: bankTransactions.counterpartIban,
			name: bankTransactions.counterpartName,
			category: expenses.category,
			propertyId: expenses.propertyId,
			unitId: expenses.unitId,
			description: expenses.description,
			serviceProviderId: expenses.serviceProviderId
		})
		.from(expenses)
		.innerJoin(bankTransactions, eq(expenses.bankTransactionId, bankTransactions.id))
		.where(eq(expenses.accountId, accountId))
		.orderBy(asc(expenses.createdAt));
	const byIban = new Map<string, ExpensePreset>();
	const byName = new Map<string, ExpensePreset>();
	for (const row of rows) {
		const preset: ExpensePreset = {
			category: row.category,
			scope: expenseScopeValue(row),
			description: row.description,
			serviceProviderId: row.serviceProviderId ?? ''
		};
		if (row.iban) byIban.set(row.iban, preset);
		const name = row.name?.trim().toLowerCase();
		if (name) byName.set(name, preset);
	}
	return { byIban, byName };
}

/** The preset of a transaction: the IBAN's, else the name's. */
export function expensePreset(
	transaction: Pick<BankTransaction, 'counterpartIban' | 'counterpartName'>,
	presets: { byIban: Map<string, ExpensePreset>; byName: Map<string, ExpensePreset> }
): ExpensePreset | undefined {
	const name = transaction.counterpartName?.trim().toLowerCase();
	return (
		(transaction.counterpartIban ? presets.byIban.get(transaction.counterpartIban) : undefined) ??
		(name ? presets.byName.get(name) : undefined)
	);
}

/** What the suggestion looks for per lease: the tenants' last names and the unit names. */
export function leaseHints(summaries: readonly LeaseSummary[]): LeaseHints[] {
	return summaries.map((lease) => ({
		id: lease.id,
		lastNames: lease.tenants.map((tenant) => tenant.lastName),
		unitNames: [lease.unit.name, ...lease.extraUnits.map((unit) => unit.name)]
	}));
}

export function transactionLabel(
	transaction: Pick<BankTransaction, 'amount' | 'bookingDate' | 'counterpartName'>
): string {
	const who = transaction.counterpartName || 'ohne Namen';
	return `Umsatz ${formatCents(transaction.amount)} vom ${formatDate(transaction.bookingDate)} (${who})`;
}

/**
 * A batch statement that fails the whole batch unless the transaction still has `status`: when
 * the status differs it copies the row onto its own primary key, which the key refuses. The
 * status check before a batch is only a read, so two requests (a double click, two tabs) can both
 * pass it; their batches run one after the other, and the second one fails here instead of
 * booking the money twice. It goes first in the batch.
 */
function statusGuard(
	db: Database,
	accountId: string,
	transactionId: string,
	status: BankTransactionStatus
) {
	return db.insert(bankTransactions).select(
		db
			.select()
			.from(bankTransactions)
			.where(
				and(
					eq(bankTransactions.accountId, accountId),
					eq(bankTransactions.id, transactionId),
					ne(bankTransactions.status, status)
				)
			)
	);
}

/**
 * Runs a batch that starts with statusGuard. False when the guard failed because another request
 * changed the status first; any other error is thrown.
 */
async function runGuarded(
	db: Database,
	accountId: string,
	transactionId: string,
	status: BankTransactionStatus,
	statements: BatchItem<'sqlite'>[]
): Promise<boolean> {
	try {
		await runBatch(db, [statusGuard(db, accountId, transactionId, status), ...statements]);
		return true;
	} catch (cause) {
		const current = await getTransaction(db, accountId, transactionId);
		if (current && current.status !== status) return false;
		throw cause;
	}
}

export type AssignOutcome =
	'assigned' | 'missing' | 'not-open' | 'unknown-lease' | 'amount-mismatch';

/** The leases earlier payments and deposit movements from the counterpart went to. Two queries. */
async function earlierLeaseIds(
	db: Database,
	accountId: string,
	transaction: Pick<BankTransaction, 'counterpartIban' | 'counterpartName'>
): Promise<string[]> {
	const counterpart = transaction.counterpartIban
		? eq(bankTransactions.counterpartIban, transaction.counterpartIban)
		: // Name rules match case-insensitively, so the history does too (SQLite lowers ASCII only).
			sql`lower(${bankTransactions.counterpartName}) = lower(${transaction.counterpartName})`;
	const [paymentRows, depositRows] = await Promise.all([
		db
			.selectDistinct({ leaseId: payments.leaseId })
			.from(payments)
			.innerJoin(bankTransactions, eq(payments.bankTransactionId, bankTransactions.id))
			.where(and(eq(payments.accountId, accountId), counterpart)),
		db
			.selectDistinct({ leaseId: depositTransactions.leaseId })
			.from(depositTransactions)
			.innerJoin(bankTransactions, eq(depositTransactions.bankTransactionId, bankTransactions.id))
			.where(and(eq(depositTransactions.accountId, accountId), counterpart))
	]);
	return [...paymentRows, ...depositRows].map((row) => row.leaseId);
}

/**
 * The rule statements of the assignment (see rememberStep). A full rule quota leaves the
 * counterpart unremembered instead of refusing the assignment.
 */
async function rememberStatements(
	db: Database,
	context: AuditContext,
	transaction: BankTransaction,
	input: AssignmentInput
): Promise<BatchItem<'sqlite'>[]> {
	const leaseIds = [...new Set(input.parts.map((part) => part.leaseId))];
	const [rules, earlier] = await Promise.all([
		listRules(db, context.accountId),
		earlierLeaseIds(db, context.accountId, transaction)
	]);
	const step = rememberStep(
		transaction,
		{ leaseIds, rent: input.target === 'rent' },
		{ rules, earlierLeaseIds: earlier }
	);
	if (!step) return [];
	if (step.kind === 'unconfirm') {
		const ids = new Set(step.ruleIds);
		return unconfirmEntries(
			db,
			context,
			rules.filter((rule) => ids.has(rule.id))
		);
	}
	if ((await usage(db, context.accountId, 'matchingRules')) >= QUOTAS.matchingRules.max) return [];
	const { field, pattern } = step;
	return ruleEntry(db, context, { leaseId: leaseIds[0], field, pattern, confirmed: true })
		.statements;
}

/**
 * Books the transaction as payment(s) or a deposit movement on the chosen lease(s), marks it
 * matched and remembers the counterpart or demotes its rules (see rememberStep). One batch.
 */
export async function assignTransaction(
	db: Database,
	context: AuditContext,
	transactionId: string,
	input: AssignmentInput
): Promise<AssignOutcome> {
	const { accountId } = context;
	const transaction = await getTransaction(db, accountId, transactionId);
	if (!transaction) return 'missing';
	if (transaction.status !== 'unmatched') return 'not-open';
	const leaseIds = [...new Set(input.parts.map((part) => part.leaseId))];
	const ownLeases = await db
		.select({ id: leases.id })
		.from(leases)
		.where(and(eq(leases.accountId, accountId), inArray(leases.id, leaseIds)));
	if (ownLeases.length !== leaseIds.length) return 'unknown-lease';
	const sum = input.parts.reduce((total, part) => total + part.amount, 0);
	if (sum !== transaction.amount || input.parts.some((part) => part.amount === 0)) {
		return 'amount-mismatch';
	}
	await assertQuota(
		db,
		accountId,
		input.target === 'rent' ? 'payments' : 'depositTransactions',
		input.parts.length
	);

	const statements: BatchItem<'sqlite'>[] = [];
	for (const part of input.parts) {
		if (input.target === 'rent') {
			statements.push(
				paymentEntry(db, context, {
					leaseId: part.leaseId,
					date: transaction.bookingDate,
					amount: part.amount,
					source: 'bank',
					bankTransactionId: transaction.id,
					note: transaction.purpose || null
				}).statement
			);
		} else {
			statements.push(
				db.insert(depositTransactions).values({
					id: crypto.randomUUID(),
					accountId,
					leaseId: part.leaseId,
					date: transaction.bookingDate,
					amount: part.amount,
					kind: part.amount > 0 ? 'received' : 'returned',
					bankTransactionId: transaction.id,
					note: transaction.purpose || null
				})
			);
		}
	}
	statements.push(...(await rememberStatements(db, context, transaction, input)));
	const what = input.target === 'rent' ? 'als Zahlung' : 'auf die Kaution';
	const parts =
		input.parts.length > 1 ? ` (aufgeteilt auf ${input.parts.length} Mietverträge)` : '';
	const done = await runGuarded(db, accountId, transaction.id, 'unmatched', [
		...statements,
		db
			.update(bankTransactions)
			.set({ status: 'matched' })
			.where(
				and(eq(bankTransactions.accountId, accountId), eq(bankTransactions.id, transaction.id))
			),
		auditEntry(
			db,
			context,
			'bankTransaction',
			transaction.id,
			'assign',
			`${transactionLabel(transaction)} ${what} zugeordnet${parts}`
		)
	]);
	return done ? 'assigned' : 'not-open';
}

/**
 * Books the transaction as an expense: an outgoing transaction as money paid out, an incoming one
 * as a refund (a negative expense). Marks it matched. One batch.
 */
export async function assignExpense(
	db: Database,
	context: AuditContext,
	transactionId: string,
	input: ExpenseAssignmentInput
): Promise<'assigned' | 'missing' | 'not-open' | 'unknown-scope' | 'unknown-service-provider'> {
	const { accountId } = context;
	const transaction = await getTransaction(db, accountId, transactionId);
	if (!transaction) return 'missing';
	if (transaction.status !== 'unmatched') return 'not-open';
	const scope = await resolveScope(db, accountId, input.scope);
	if (!scope) return 'unknown-scope';
	if (!(await knownServiceProvider(db, accountId, input.serviceProviderId))) {
		return 'unknown-service-provider';
	}
	await assertQuota(db, accountId, 'expenses');
	const id = crypto.randomUUID();
	const row = {
		id,
		accountId,
		...scope,
		date: transaction.bookingDate,
		amount: -transaction.amount,
		category: input.category,
		description: input.description,
		serviceProviderId: input.serviceProviderId ?? null,
		bankTransactionId: transaction.id
	};
	const done = await runGuarded(db, accountId, transaction.id, 'unmatched', [
		db.insert(expenses).values(row),
		db
			.update(bankTransactions)
			.set({ status: 'matched' })
			.where(
				and(eq(bankTransactions.accountId, accountId), eq(bankTransactions.id, transaction.id))
			),
		auditEntry(
			db,
			context,
			'bankTransaction',
			transaction.id,
			'assign',
			`${transactionLabel(transaction)} als ${expenseSummary(row)} zugeordnet`
		)
	]);
	return done ? 'assigned' : 'not-open';
}

/** Deletes the payments, deposit movements and expenses of the transaction and reopens it. */
export async function undoAssignment(
	db: Database,
	context: AuditContext,
	transactionId: string
): Promise<'undone' | 'missing' | 'not-matched'> {
	const { accountId } = context;
	const transaction = await getTransaction(db, accountId, transactionId);
	if (!transaction) return 'missing';
	if (transaction.status !== 'matched') return 'not-matched';
	const done = await runGuarded(db, accountId, transaction.id, 'matched', [
		db
			.delete(payments)
			.where(
				and(eq(payments.accountId, accountId), eq(payments.bankTransactionId, transaction.id))
			),
		db
			.delete(depositTransactions)
			.where(
				and(
					eq(depositTransactions.accountId, accountId),
					eq(depositTransactions.bankTransactionId, transaction.id)
				)
			),
		db
			.delete(expenses)
			.where(
				and(eq(expenses.accountId, accountId), eq(expenses.bankTransactionId, transaction.id))
			),
		db
			.update(bankTransactions)
			.set({ status: 'unmatched' })
			.where(
				and(eq(bankTransactions.accountId, accountId), eq(bankTransactions.id, transaction.id))
			),
		auditEntry(
			db,
			context,
			'bankTransaction',
			transaction.id,
			'undo',
			`Zuordnung von ${transactionLabel(transaction)} aufgehoben`
		)
	]);
	return done ? 'undone' : 'not-matched';
}

/** Moves the transaction from `from` to `status`; false when another request moved it first. */
async function setStatus(
	db: Database,
	context: AuditContext,
	transaction: BankTransaction,
	from: BankTransactionStatus,
	status: BankTransactionStatus,
	action: 'ignore' | 'update',
	summary: string
): Promise<boolean> {
	return runGuarded(db, context.accountId, transaction.id, from, [
		db
			.update(bankTransactions)
			.set({ status })
			.where(
				and(
					eq(bankTransactions.accountId, context.accountId),
					eq(bankTransactions.id, transaction.id)
				)
			),
		auditEntry(db, context, 'bankTransaction', transaction.id, action, summary)
	]);
}

/** An open transaction that is no rent (a fee, a refund): out of the review list. */
export async function ignoreTransaction(
	db: Database,
	context: AuditContext,
	transactionId: string
): Promise<'ignored' | 'missing' | 'not-open'> {
	const transaction = await getTransaction(db, context.accountId, transactionId);
	if (!transaction) return 'missing';
	if (transaction.status !== 'unmatched') return 'not-open';
	const done = await setStatus(
		db,
		context,
		transaction,
		'unmatched',
		'ignored',
		'ignore',
		`${transactionLabel(transaction)} ignoriert`
	);
	return done ? 'ignored' : 'not-open';
}

export async function reopenTransaction(
	db: Database,
	context: AuditContext,
	transactionId: string
): Promise<'reopened' | 'missing' | 'not-ignored'> {
	const transaction = await getTransaction(db, context.accountId, transactionId);
	if (!transaction) return 'missing';
	if (transaction.status !== 'ignored') return 'not-ignored';
	const done = await setStatus(
		db,
		context,
		transaction,
		'ignored',
		'unmatched',
		'update',
		`${transactionLabel(transaction)} wieder geöffnet`
	);
	return done ? 'reopened' : 'not-ignored';
}

/** A lease to assign to: the select's label, and unit and property for an assignment's two lines. */
export type LeaseOption = {
	id: string;
	label: string;
	unit: string;
	property: string;
	active: boolean;
};

/** The entries of a lease select: "EG links · Haus – Mustermann", ended leases marked. */
export function leaseOptions(summaries: readonly LeaseSummary[]): LeaseOption[] {
	return summaries.map((lease) => {
		const names = lease.tenants.map((tenant) => tenant.lastName).join(', ');
		const label = names ? `${leaseLabel(lease)} – ${names}` : leaseLabel(lease);
		return {
			id: lease.id,
			label: lease.active ? label : `${label} (beendet)`,
			unit: lease.unit.name,
			property: lease.property.name,
			active: lease.active
		};
	});
}
