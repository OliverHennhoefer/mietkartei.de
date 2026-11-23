import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { ContraAccountInput } from '../../forms/contra-accounts';
import { contraAccountKindShortLabels } from '../../labels';
import { auditEntry, type AuditContext } from '../audit';
import type { Database } from '../db';
import { runBatch } from '../db/batch';
import {
	contraAccountFor,
	splitPayment,
	type MonthlyCharge,
	type PaymentPart
} from '../../domain/contra-accounts';
import {
	bankTransactions,
	contraAccounts,
	depositTransactions,
	expenses,
	leases,
	otherBookings,
	payments,
	properties,
	rentCharges,
	units
} from '../db/schema';
import { assertQuota } from '../quotas';

// Gegenkonten: the landlord's own accounts of their bookkeeping („4401 Grundsteuer“, „8005
// Mieten Rudolf“), which a bank transaction is booked to. The kind says what a booking creates
// (a payment, an expense or an other booking); the number is the landlord's own and optional.

export type ContraAccount = typeof contraAccounts.$inferSelect;

/** By number (accounts without one last), then by name. */
export async function listContraAccounts(
	db: Database,
	accountId: string
): Promise<ContraAccount[]> {
	return db
		.select()
		.from(contraAccounts)
		.where(eq(contraAccounts.accountId, accountId))
		.orderBy(
			sql`${contraAccounts.number} is null`,
			// Numbers sort as numbers where they are numbers („900“ before „4401“).
			sql`cast(${contraAccounts.number} as integer)`,
			asc(contraAccounts.number),
			asc(contraAccounts.name)
		);
}

export async function getContraAccount(
	db: Database,
	accountId: string,
	id: string
): Promise<ContraAccount | undefined> {
	const [row] = await db
		.select()
		.from(contraAccounts)
		.where(and(eq(contraAccounts.accountId, accountId), eq(contraAccounts.id, id)));
	return row;
}

/** „4401 Grundsteuer“, or the name alone without a number. */
export function contraAccountLabel(account: Pick<ContraAccount, 'number' | 'name'>): string {
	return account.number ? `${account.number} ${account.name}` : account.name;
}

function summary(account: Pick<ContraAccount, 'number' | 'name' | 'kind'>, verb: string): string {
	return `Gegenkonto „${contraAccountLabel(account)}“ (${contraAccountKindShortLabels[account.kind]}) ${verb}`;
}

export type ContraAccountRefusal = 'unknown-property' | 'duplicate-number';

async function check(
	db: Database,
	accountId: string,
	input: ContraAccountInput,
	exceptId?: string
): Promise<ContraAccountRefusal | null> {
	if (input.propertyId) {
		const [property] = await db
			.select({ id: properties.id })
			.from(properties)
			.where(and(eq(properties.accountId, accountId), eq(properties.id, input.propertyId)));
		if (!property) return 'unknown-property';
	}
	if (input.number) {
		const [same] = await db
			.select({ id: contraAccounts.id })
			.from(contraAccounts)
			.where(and(eq(contraAccounts.accountId, accountId), eq(contraAccounts.number, input.number)));
		if (same && same.id !== exceptId) return 'duplicate-number';
	}
	return null;
}

export async function createContraAccount(
	db: Database,
	context: AuditContext,
	input: ContraAccountInput
): Promise<{ ok: true; id: string } | { ok: false; reason: ContraAccountRefusal }> {
	await assertQuota(db, context.accountId, 'contraAccounts');
	const refusal = await check(db, context.accountId, input);
	if (refusal) return { ok: false, reason: refusal };
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(contraAccounts).values({ id, accountId: context.accountId, ...input }),
		auditEntry(db, context, 'contraAccount', id, 'create', summary(input, 'angelegt'))
	]);
	return { ok: true, id };
}

/**
 * Changes number, name, kind, category and property. What was booked to the account keeps its
 * own category and place; only new bookings take the change.
 */
export async function updateContraAccount(
	db: Database,
	context: AuditContext,
	id: string,
	input: ContraAccountInput
): Promise<{ ok: true } | { ok: false; reason: ContraAccountRefusal | 'missing' }> {
	if (!(await getContraAccount(db, context.accountId, id))) return { ok: false, reason: 'missing' };
	const refusal = await check(db, context.accountId, input, id);
	if (refusal) return { ok: false, reason: refusal };
	await runBatch(db, [
		db
			.update(contraAccounts)
			.set(input)
			.where(and(eq(contraAccounts.accountId, context.accountId), eq(contraAccounts.id, id))),
		auditEntry(db, context, 'contraAccount', id, 'update', summary(input, 'geändert'))
	]);
	return { ok: true };
}

/** Deletes the account; the payments, expenses and other bookings on it stay, without account. */
export async function deleteContraAccount(
	db: Database,
	context: AuditContext,
	id: string
): Promise<boolean> {
	const { accountId } = context;
	const account = await getContraAccount(db, accountId, id);
	if (!account) return false;
	await runBatch(db, [
		db
			.update(payments)
			.set({ contraAccountId: null })
			.where(and(eq(payments.accountId, accountId), eq(payments.contraAccountId, id))),
		db
			.update(depositTransactions)
			.set({ contraAccountId: null })
			.where(
				and(
					eq(depositTransactions.accountId, accountId),
					eq(depositTransactions.contraAccountId, id)
				)
			),
		db
			.update(expenses)
			.set({ contraAccountId: null })
			.where(and(eq(expenses.accountId, accountId), eq(expenses.contraAccountId, id))),
		db
			.update(otherBookings)
			.set({ contraAccountId: null })
			.where(and(eq(otherBookings.accountId, accountId), eq(otherBookings.contraAccountId, id))),
		db
			.delete(contraAccounts)
			.where(and(eq(contraAccounts.accountId, accountId), eq(contraAccounts.id, id))),
		auditEntry(db, context, 'contraAccount', id, 'delete', summary(account, 'gelöscht'))
	]);
	return true;
}

/** The property of each lease (by its main unit). One query. */
async function leaseProperties(
	db: Database,
	accountId: string,
	leaseIds: readonly string[]
): Promise<Map<string, string>> {
	if (!leaseIds.length) return new Map();
	const rows = await db
		.select({ leaseId: leases.id, propertyId: units.propertyId })
		.from(leases)
		.innerJoin(units, eq(units.id, leases.unitId))
		.where(and(eq(leases.accountId, accountId), inArray(leases.id, [...leaseIds])));
	return new Map(rows.map((row) => [row.leaseId, row.propertyId]));
}

/** Days back a statement's Nachzahlung or Guthaben is still recognised in a payment. */
const STATEMENT_WINDOW_MONTHS = 18;

function monthsBefore(date: string, months: number): string {
	const [year, month] = date.slice(0, 7).split('-').map(Number);
	const index = year * 12 + (month - 1) - months;
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * How each lease's part of a tenant's payment is booked to the Gegenkonten: Kaltmiete and
 * Nebenkosten apart, a Nachzahlung to Nebenkosten Vorjahr (see splitPayment). The accounts come
 * from the lease's property. A fixed number of queries.
 */
export async function planPayments(
	db: Database,
	accountId: string,
	parts: readonly { leaseId: string; amount: number }[],
	date: string,
	accounts?: readonly ContraAccount[]
): Promise<Map<string, PaymentPart[]>> {
	const leaseIds = [...new Set(parts.map((part) => part.leaseId))];
	const month = date.slice(0, 7);
	const [all, propertyOf, monthlyRows, statementRows] = await Promise.all([
		accounts ?? listContraAccounts(db, accountId),
		leaseProperties(db, accountId, leaseIds),
		leaseIds.length
			? db
					.select({
						leaseId: rentCharges.leaseId,
						period: rentCharges.period,
						amount: rentCharges.amount,
						operatingCostPrepayment: rentCharges.operatingCostPrepayment,
						heatingCostPrepayment: rentCharges.heatingCostPrepayment
					})
					.from(rentCharges)
					.where(
						and(
							eq(rentCharges.accountId, accountId),
							inArray(rentCharges.leaseId, leaseIds),
							eq(rentCharges.kind, 'rent'),
							lte(rentCharges.period, month)
						)
					)
					.orderBy(desc(rentCharges.period))
			: [],
		leaseIds.length
			? db
					.select({ leaseId: rentCharges.leaseId, amount: rentCharges.amount })
					.from(rentCharges)
					.where(
						and(
							eq(rentCharges.accountId, accountId),
							inArray(rentCharges.leaseId, leaseIds),
							eq(rentCharges.kind, 'statement_balance'),
							gte(rentCharges.period, monthsBefore(date, STATEMENT_WINDOW_MONTHS))
						)
					)
			: []
	]);
	const result = new Map<string, PaymentPart[]>();
	for (const part of parts) {
		const propertyId = propertyOf.get(part.leaseId) ?? null;
		// The newest monthly charge up to the payment's month; rows come newest first.
		const monthly: MonthlyCharge | null =
			monthlyRows.find((row) => row.leaseId === part.leaseId) ?? null;
		result.set(
			part.leaseId,
			splitPayment(part.amount, {
				monthly,
				statementBalances: statementRows
					.filter((row) => row.leaseId === part.leaseId)
					.map((row) => row.amount),
				accounts: {
					rent: contraAccountFor(all, 'rent', propertyId),
					operating_costs: contraAccountFor(all, 'operating_costs', propertyId),
					statement_balance: contraAccountFor(all, 'statement_balance', propertyId)
				}
			})
		);
	}
	return result;
}

/** The Gegenkonto of kind deposit for a lease's property, or null. Two queries. */
export async function depositContraAccount(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<string | null> {
	const [all, propertyOf] = await Promise.all([
		listContraAccounts(db, accountId),
		leaseProperties(db, accountId, [leaseId])
	]);
	return contraAccountFor(all, 'deposit', propertyOf.get(leaseId) ?? null) ?? null;
}

export type ContraAccountTotal = { amount: number; count: number };

/**
 * What was booked from the bank to each Gegenkonto in a calendar year, as the bank sees it
 * (money in positive, money out negative), and how many bookings; key null for bookings without
 * a Gegenkonto. The same bookings and dates as the DATEV-Export, so the sums match its Stapel.
 * Four queries.
 */
export async function contraAccountTotals(
	db: Database,
	accountId: string,
	year: number
): Promise<Map<string | null, ContraAccountTotal>> {
	const from = `${year}-01-01`;
	const to = `${year}-12-31`;
	const sumOf = (
		table: typeof payments | typeof depositTransactions | typeof expenses | typeof otherBookings
	) =>
		db
			.select({
				contraAccountId: table.contraAccountId,
				amount: sql<number>`coalesce(sum(case when ${bankTransactions.amount} < 0 then -abs(${table.amount}) else abs(${table.amount}) end), 0)`,
				count: sql<number>`count(*)`
			})
			.from(table)
			.innerJoin(bankTransactions, eq(bankTransactions.id, table.bankTransactionId))
			.where(
				and(
					eq(table.accountId, accountId),
					eq(bankTransactions.accountId, accountId),
					gte(bankTransactions.bookingDate, from),
					lte(bankTransactions.bookingDate, to)
				)
			)
			.groupBy(table.contraAccountId);
	const groups = await Promise.all([
		sumOf(payments),
		sumOf(depositTransactions),
		sumOf(expenses),
		sumOf(otherBookings)
	]);
	const totals = new Map<string | null, ContraAccountTotal>();
	for (const row of groups.flat()) {
		const total = totals.get(row.contraAccountId) ?? { amount: 0, count: 0 };
		total.amount += Number(row.amount);
		total.count += Number(row.count);
		totals.set(row.contraAccountId, total);
	}
	return totals;
}
