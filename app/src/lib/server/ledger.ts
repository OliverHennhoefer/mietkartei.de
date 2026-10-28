import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
	dayOf,
	firstOfMonth,
	formatDate,
	formatMonth,
	monthOf,
	today,
	type IsoDate,
	type IsoMonth
} from '../dates';
import {
	diffCharges,
	expectedRentCharges,
	type ChargeTerm,
	type ExpectedCharge
} from '../domain/charges';
import type { RentChange } from '../domain/rents';
import { rentChargeKindLabels } from '../labels';
import { formatCents } from '../money';
import type { GermanState } from '../working-days';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { chunk, chunkIds, rowsPerStatement, runBatch } from './db/batch';
import {
	leases,
	payments,
	properties,
	rentCharges,
	rentChanges,
	units,
	type PaymentSource,
	type RentChargeKind
} from './db/schema';
import { assertQuota } from './quotas';

// The rent ledger (Mietkonto): what a lease owes (rent_charges, Soll) against what was paid
// (payments, Ist). Monthly rent charges are derived from the lease term and the rent history and
// synced on demand by ensureCharges; everything else on the ledger is posted explicitly, by the
// landlord (adjustments, payments), by the banking feature (payments from bank transactions) or
// by the statement and CO₂ features through chargeEntry.

type Statement = BatchItem<'sqlite'>;

function groupByLease<T extends { leaseId: string }>(rows: readonly T[]): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const row of rows) {
		const group = groups.get(row.leaseId);
		if (group) group.push(row);
		else groups.set(row.leaseId, [row]);
	}
	return groups;
}

export type ChargeSync = { inserted: number; updated: number; removed: number };

/** A lease as the rent charges see it: its term, due day and state, and its rent history. */
export type ChargeLease = ChargeTerm & { id: string; changes: readonly RentChange[] };

/** The charge view of the given leases of the account, as stored. Three selects per 90 leases. */
export async function loadChargeLeases(
	db: Database,
	accountId: string,
	leaseIds: readonly string[]
): Promise<ChargeLease[]> {
	const requested = [...new Set(leaseIds)];
	if (requested.length === 0) return [];
	const leaseRows = (
		await Promise.all(
			chunkIds(requested).map((ids) =>
				db
					.select({
						id: leases.id,
						startDate: leases.startDate,
						endDate: leases.endDate,
						ledgerStart: leases.ledgerStart,
						rentDueDay: leases.rentDueDay,
						state: properties.state
					})
					.from(leases)
					.innerJoin(units, eq(units.id, leases.unitId))
					.innerJoin(properties, eq(properties.id, units.propertyId))
					.where(and(eq(leases.accountId, accountId), inArray(leases.id, ids)))
			)
		)
	).flat();
	if (leaseRows.length === 0) return [];
	const changeRows = (
		await Promise.all(
			chunkIds(leaseRows.map((lease) => lease.id)).map((ids) =>
				db
					.select({
						leaseId: rentChanges.leaseId,
						validFrom: rentChanges.validFrom,
						baseRent: rentChanges.baseRent,
						operatingCostPrepayment: rentChanges.operatingCostPrepayment,
						heatingCostPrepayment: rentChanges.heatingCostPrepayment,
						status: rentChanges.status
					})
					.from(rentChanges)
					.where(
						and(
							eq(rentChanges.accountId, accountId),
							inArray(rentChanges.leaseId, ids),
							eq(rentChanges.status, 'approved')
						)
					)
			)
		)
	).flat();
	const changesByLease: Map<string, RentChange[]> = groupByLease(changeRows);
	return leaseRows.map((lease) => ({ ...lease, changes: changesByLease.get(lease.id) ?? [] }));
}

/** The Bundesland of each unit's property, for the due dates of leases not stored yet. */
export async function unitStates(
	db: Database,
	accountId: string,
	unitIds: readonly string[]
): Promise<Map<string, GermanState | null>> {
	const rows = (
		await Promise.all(
			chunkIds([...new Set(unitIds)]).map((ids) =>
				db
					.select({ unitId: units.id, state: properties.state })
					.from(units)
					.innerJoin(properties, eq(properties.id, units.propertyId))
					.where(and(eq(units.accountId, accountId), inArray(units.id, ids)))
			)
		)
	).flat();
	return new Map(rows.map((row) => [row.unitId, row.state]));
}

/**
 * The statements that bring the `rent` charges of the given leases in line with their term and
 * rent history, up to `untilMonth`, for the caller's batch. The leases are passed as they will be
 * once that batch ran, so a command that changes a lease or its history commits the change and
 * the charges together, or neither; the quota is checked here, before anything is written. Rows
 * already stored beyond `untilMonth` stay as long as they are within the term, so a call with an
 * earlier horizon never deletes what a later one generated. `otherCharges` counts the rows of other
 * kinds the caller's batch inserts as well (an Anfangssaldo), so the quota check covers the whole
 * batch. Only leases of the account are touched, other kinds of charges never. Derived data, so
 * no audit entries.
 */
export async function chargeSyncStatements(
	db: Database,
	accountId: string,
	chargeLeases: readonly ChargeLease[],
	{
		untilMonth = monthOf(today()),
		otherCharges = 0
	}: { untilMonth?: IsoMonth; otherCharges?: number } = {}
): Promise<{ statements: Statement[]; sync: ChargeSync }> {
	const nothing = { statements: [], sync: { inserted: 0, updated: 0, removed: 0 } };
	if (otherCharges > 0) await assertQuota(db, accountId, 'rentCharges', otherCharges);
	if (chargeLeases.length === 0) return nothing;
	const chargeRows = (
		await Promise.all(
			chunkIds(chargeLeases.map((lease) => lease.id)).map((ids) =>
				db
					.select({
						id: rentCharges.id,
						leaseId: rentCharges.leaseId,
						period: rentCharges.period,
						dueDate: rentCharges.dueDate,
						baseRent: rentCharges.baseRent,
						operatingCostPrepayment: rentCharges.operatingCostPrepayment,
						heatingCostPrepayment: rentCharges.heatingCostPrepayment,
						amount: rentCharges.amount
					})
					.from(rentCharges)
					.where(
						and(
							eq(rentCharges.accountId, accountId),
							inArray(rentCharges.leaseId, ids),
							eq(rentCharges.kind, 'rent')
						)
					)
			)
		)
	).flat();
	// Rent charges always have a due date; only a statement's Nachzahlung waits for one.
	const chargesByLease = groupByLease(
		chargeRows.map((row) => ({ ...row, dueDate: row.dueDate ?? '' }))
	);

	const inserts: (typeof rentCharges.$inferInsert)[] = [];
	const updates: (ExpectedCharge & { id: string })[] = [];
	const removals: string[] = [];
	for (const lease of chargeLeases) {
		const existing = chargesByLease.get(lease.id) ?? [];
		// Keep checking the months already generated, even past the requested horizon.
		const horizon = existing.reduce(
			(latest, row) => (row.period > latest ? row.period : latest),
			untilMonth
		);
		const expected = expectedRentCharges(lease, lease.changes, horizon);
		const diff = diffCharges(existing, expected);
		for (const charge of diff.insert) {
			inserts.push({
				id: crypto.randomUUID(),
				accountId,
				leaseId: lease.id,
				kind: 'rent',
				...charge
			});
		}
		updates.push(...diff.update);
		removals.push(...diff.remove);
	}

	if (inserts.length > 0) {
		await assertQuota(db, accountId, 'rentCharges', inserts.length + otherCharges);
	}
	const statements: Statement[] = [
		// Two requests may sync the same lease at once; the unique index lets the second one lose.
		...chunk(inserts, rowsPerStatement(rentCharges)).map((rows) =>
			db.insert(rentCharges).values(rows).onConflictDoNothing()
		),
		...updates.map((charge) =>
			db
				.update(rentCharges)
				.set({
					dueDate: charge.dueDate,
					baseRent: charge.baseRent,
					operatingCostPrepayment: charge.operatingCostPrepayment,
					heatingCostPrepayment: charge.heatingCostPrepayment,
					amount: charge.amount
				})
				.where(and(eq(rentCharges.accountId, accountId), eq(rentCharges.id, charge.id)))
		),
		...chunkIds(removals).map((ids) =>
			db
				.delete(rentCharges)
				.where(
					and(
						eq(rentCharges.accountId, accountId),
						eq(rentCharges.kind, 'rent'),
						inArray(rentCharges.id, ids)
					)
				)
		)
	];
	return {
		statements,
		sync: { inserted: inserts.length, updated: updates.length, removed: removals.length }
	};
}

/**
 * chargeSyncStatements for one stored lease, with what the caller's batch changes in it (`pending`:
 * the term, the state of a new unit, the rent history). Nothing when the lease is not the account's.
 */
export async function leaseChargeStatements(
	db: Database,
	accountId: string,
	leaseId: string,
	pending: Partial<Omit<ChargeLease, 'id'>> = {}
): Promise<Statement[]> {
	const [lease] = await loadChargeLeases(db, accountId, [leaseId]);
	if (!lease) return [];
	return (await chargeSyncStatements(db, accountId, [{ ...lease, ...pending }])).statements;
}

/**
 * Brings the `rent` charges of the given stored leases in line with their term and rent history,
 * up to `untilMonth`; see chargeSyncStatements. A command that changes a lease or its history
 * builds those statements into its own batch instead.
 */
export async function ensureCharges(
	db: Database,
	accountId: string,
	leaseIds: string[],
	untilMonth: IsoMonth = monthOf(today())
): Promise<ChargeSync> {
	const chargeLeases = await loadChargeLeases(db, accountId, leaseIds);
	const { statements, sync } = await chargeSyncStatements(db, accountId, chargeLeases, {
		untilMonth
	});
	await runBatch(db, statements);
	return sync;
}

async function ownsLease(db: Database, accountId: string, leaseId: string): Promise<boolean> {
	const rows = await db
		.select({ id: leases.id })
		.from(leases)
		.where(and(eq(leases.accountId, accountId), eq(leases.id, leaseId)));
	return rows.length > 0;
}

export type ChargeInput = {
	leaseId: string;
	/** Rent charges are derived; see ensureCharges. */
	kind: Exclude<RentChargeKind, 'rent'>;
	period: IsoMonth;
	/** Null while not due: a statement's Nachzahlung before the statement reached the tenant. */
	dueDate: IsoDate | null;
	/** Positive = the tenant owes, negative = a credit to the tenant. */
	amount: number;
	/** The statement or CO₂ split the charge comes from; posted once per lease (unique index). */
	referenceId?: string | null;
	/** The charge this one reverses, for a corrected or late delivered statement. */
	reversesChargeId?: string | null;
	note?: string | null;
};

function chargeSummary(
	charge: { kind: RentChargeKind; period: IsoMonth; amount: number },
	verb: string
): string {
	const what = `${rentChargeKindLabels[charge.kind]} ${formatMonth(charge.period)}`;
	return charge.amount < 0
		? `${what} als Gutschrift über ${formatCents(-charge.amount)} ${verb}`
		: `${what} über ${formatCents(charge.amount)} ${verb}`;
}

/**
 * The insert statement for a charge, with its id, so a feature can post the charge inside its
 * own runBatch together with the records it belongs to and its audit entry. The lease must
 * already be checked against the account.
 */
export function chargeEntry(
	db: Database,
	context: AuditContext,
	input: ChargeInput,
	id: string = crypto.randomUUID()
): { id: string; statement: Statement } {
	const statement = db.insert(rentCharges).values({
		id,
		accountId: context.accountId,
		leaseId: input.leaseId,
		period: input.period,
		dueDate: input.dueDate,
		amount: input.amount,
		kind: input.kind,
		referenceId: input.referenceId ?? null,
		reversesChargeId: input.reversesChargeId ?? null,
		note: input.note ?? null
	});
	return { id, statement };
}

/**
 * The insert of a charge with its audit entry, for a caller's batch (createLease posts the opening
 * balance with the new lease). The lease must already be checked against the account.
 */
export function chargeStatements(
	db: Database,
	context: AuditContext,
	id: string,
	input: ChargeInput
): BatchItem<'sqlite'>[] {
	return [
		chargeEntry(db, context, input, id).statement,
		auditEntry(db, context, 'lease', input.leaseId, 'post', chargeSummary(input, 'gebucht'))
	];
}

/** Posts a charge with its audit entry. Returns undefined when the lease is not in the account. */
export async function postCharge(
	db: Database,
	context: AuditContext,
	input: ChargeInput
): Promise<string | undefined> {
	await assertQuota(db, context.accountId, 'rentCharges');
	if (!(await ownsLease(db, context.accountId, input.leaseId))) return undefined;
	const id = crypto.randomUUID();
	await runBatch(db, chargeStatements(db, context, id, input));
	return id;
}

/**
 * Deletes a manual posting. Rent rows are derived and would come back with the next sync;
 * statement and CO₂ postings are reversed by the feature that posted them, never deleted.
 */
export async function deleteCharge(
	db: Database,
	context: AuditContext,
	chargeId: string
): Promise<boolean> {
	const [charge] = await db
		.select()
		.from(rentCharges)
		.where(and(eq(rentCharges.accountId, context.accountId), eq(rentCharges.id, chargeId)));
	if (!charge || charge.kind !== 'adjustment') return false;
	await runBatch(db, [
		db
			.delete(rentCharges)
			.where(and(eq(rentCharges.accountId, context.accountId), eq(rentCharges.id, chargeId))),
		auditEntry(db, context, 'lease', charge.leaseId, 'delete', chargeSummary(charge, 'gelöscht'))
	]);
	return true;
}

export type PaymentInput = {
	leaseId: string;
	date: IsoDate;
	/** Positive = received from the tenant, negative = refunded. */
	amount: number;
	source: PaymentSource;
	/** The bank transaction the payment was assigned from. */
	bankTransactionId?: string | null;
	note?: string | null;
};

/** The insert statement for a payment, with its id, for the banking feature's batches. */
export function paymentEntry(
	db: Database,
	context: AuditContext,
	input: PaymentInput
): { id: string; statement: Statement } {
	const id = crypto.randomUUID();
	const statement = db.insert(payments).values({
		id,
		accountId: context.accountId,
		leaseId: input.leaseId,
		date: input.date,
		amount: input.amount,
		source: input.source,
		bankTransactionId: input.bankTransactionId ?? null,
		note: input.note ?? null
	});
	return { id, statement };
}

function paymentSummary(payment: { date: IsoDate; amount: number }, verb: string): string {
	const what = payment.amount < 0 ? 'Rückzahlung' : 'Zahlung';
	return `${what} ${formatCents(Math.abs(payment.amount))} vom ${formatDate(payment.date)} ${verb}`;
}

/** Books a payment with its audit entry. Returns undefined when the lease is not in the account. */
export async function createPayment(
	db: Database,
	context: AuditContext,
	input: PaymentInput
): Promise<string | undefined> {
	await assertQuota(db, context.accountId, 'payments');
	if (!(await ownsLease(db, context.accountId, input.leaseId))) return undefined;
	const { id, statement } = paymentEntry(db, context, input);
	await runBatch(db, [
		statement,
		auditEntry(db, context, 'lease', input.leaseId, 'create', paymentSummary(input, 'gebucht'))
	]);
	return id;
}

/**
 * Deletes a payment of the account. One assigned from a bank transaction is undone by the banking
 * feature, which also resets the transaction; deleting it here would leave the transaction
 * marked as matched.
 */
export async function deletePayment(
	db: Database,
	context: AuditContext,
	paymentId: string
): Promise<'deleted' | 'from-bank' | 'missing'> {
	const [payment] = await db
		.select()
		.from(payments)
		.where(and(eq(payments.accountId, context.accountId), eq(payments.id, paymentId)));
	if (!payment) return 'missing';
	if (payment.bankTransactionId) return 'from-bank';
	await runBatch(db, [
		db
			.delete(payments)
			.where(and(eq(payments.accountId, context.accountId), eq(payments.id, paymentId))),
		auditEntry(db, context, 'lease', payment.leaseId, 'delete', paymentSummary(payment, 'gelöscht'))
	]);
	return 'deleted';
}

/** What the edit dialog of the ledger page changes: a manual payment or an adjustment. */
export type LedgerEdit = { date: IsoDate; amount: number; note: string | null };

/**
 * A line of the lease the landlord may change on the ledger page, a manual payment or an
 * adjustment, with what it holds; undefined for any other line.
 */
export async function getEditableLine(
	db: Database,
	accountId: string,
	leaseId: string,
	id: string
): Promise<(LedgerEdit & { kind: 'payment' | 'adjustment' }) | undefined> {
	const [payment] = await db
		.select()
		.from(payments)
		.where(
			and(eq(payments.accountId, accountId), eq(payments.leaseId, leaseId), eq(payments.id, id))
		);
	if (payment) {
		if (payment.bankTransactionId) return undefined;
		return { kind: 'payment', date: payment.date, amount: payment.amount, note: payment.note };
	}
	const [charge] = await db
		.select()
		.from(rentCharges)
		.where(
			and(
				eq(rentCharges.accountId, accountId),
				eq(rentCharges.leaseId, leaseId),
				eq(rentCharges.id, id)
			)
		);
	if (!charge || charge.kind !== 'adjustment') return undefined;
	const date = charge.dueDate ?? firstOfMonth(charge.period);
	return { kind: 'adjustment', date, amount: charge.amount, note: charge.note };
}

/** Changes a manual payment; one assigned from a bank transaction is changed there. */
export async function updatePayment(
	db: Database,
	context: AuditContext,
	paymentId: string,
	input: LedgerEdit
): Promise<'updated' | 'from-bank' | 'missing'> {
	const ofAccount = and(eq(payments.accountId, context.accountId), eq(payments.id, paymentId));
	const [payment] = await db.select().from(payments).where(ofAccount);
	if (!payment) return 'missing';
	if (payment.bankTransactionId) return 'from-bank';
	await runBatch(db, [
		db.update(payments).set(input).where(ofAccount),
		auditEntry(db, context, 'lease', payment.leaseId, 'update', paymentSummary(input, 'geändert'))
	]);
	return 'updated';
}

/** Changes a manual posting (Korrektur); false for any other charge. */
export async function updateAdjustment(
	db: Database,
	context: AuditContext,
	chargeId: string,
	input: LedgerEdit
): Promise<boolean> {
	const ofAccount = and(eq(rentCharges.accountId, context.accountId), eq(rentCharges.id, chargeId));
	const [charge] = await db.select().from(rentCharges).where(ofAccount);
	if (!charge || charge.kind !== 'adjustment') return false;
	const changed = {
		period: monthOf(input.date),
		dueDate: input.date,
		amount: input.amount,
		note: input.note
	};
	await runBatch(db, [
		db.update(rentCharges).set(changed).where(ofAccount),
		auditEntry(
			db,
			context,
			'lease',
			charge.leaseId,
			'update',
			chargeSummary({ ...charge, ...changed }, 'geändert')
		)
	]);
	return true;
}

export type LedgerLine = {
	/** Due date of a charge (the day it was posted while it is not due), date of a payment. */
	date: IsoDate;
	kind: 'charge' | 'payment';
	id: string;
	/** "Miete April 2025", the kind of posting with its note, or the payment's note. */
	label: string;
	/** Charges as stored (positive = owed), payments as stored (positive = received). */
	amount: number;
	/** Charges minus payments up to this line; positive = Rückstand, negative = Guthaben. */
	balance: number;
};

export type Ledger = {
	lines: LedgerLine[];
	/** Sums of the lines returned. */
	charged: number;
	paid: number;
	/** The balance at the end of the window: what was carried over plus charged minus paid. */
	balance: number;
};

export function chargeLabel(charge: {
	kind: RentChargeKind;
	period: IsoMonth;
	note: string | null;
}) {
	const label = `${rentChargeKindLabels[charge.kind]} ${formatMonth(charge.period)}`;
	return charge.note ? `${label}: ${charge.note}` : label;
}

function paymentLabel(payment: { amount: number; note: string | null }) {
	return payment.note || (payment.amount < 0 ? 'Rückzahlung' : 'Zahlung');
}

type LedgerEntry = Omit<LedgerLine, 'balance'> & { createdAt: Date };

/** Oldest first; a charge and a payment on the same day show the charge first. */
function compareEntries(a: LedgerEntry, b: LedgerEntry): number {
	if (a.date !== b.date) return a.date < b.date ? -1 : 1;
	if (a.kind !== b.kind) return a.kind === 'charge' ? -1 : 1;
	return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

/**
 * The ledger of one lease, charges and payments interleaved with a running balance. With a
 * window, lines before `from` are left out but still count towards the balance, so the balance
 * shown is always the real one on that day.
 */
export async function listLedger(
	db: Database,
	accountId: string,
	leaseId: string,
	options: { from?: IsoDate; to?: IsoDate } = {}
): Promise<Ledger> {
	await ensureCharges(db, accountId, [leaseId]);
	const [chargeRows, paymentRows] = await Promise.all([
		db
			.select()
			.from(rentCharges)
			.where(and(eq(rentCharges.accountId, accountId), eq(rentCharges.leaseId, leaseId))),
		db
			.select()
			.from(payments)
			.where(and(eq(payments.accountId, accountId), eq(payments.leaseId, leaseId)))
	]);
	const entries: LedgerEntry[] = [
		...chargeRows.map((row) => ({
			date: row.dueDate ?? dayOf(row.createdAt),
			kind: 'charge' as const,
			id: row.id,
			label: chargeLabel(row),
			amount: row.amount,
			createdAt: row.createdAt
		})),
		...paymentRows.map((row) => ({
			date: row.date,
			kind: 'payment' as const,
			id: row.id,
			label: paymentLabel(row),
			amount: row.amount,
			createdAt: row.createdAt
		}))
	].sort(compareEntries);

	const lines: LedgerLine[] = [];
	let balance = 0;
	let charged = 0;
	let paid = 0;
	for (const entry of entries) {
		if (options.to && entry.date > options.to) break;
		balance += entry.kind === 'charge' ? entry.amount : -entry.amount;
		if (options.from && entry.date < options.from) continue;
		if (entry.kind === 'charge') charged += entry.amount;
		else paid += entry.amount;
		lines.push({
			date: entry.date,
			kind: entry.kind,
			id: entry.id,
			label: entry.label,
			amount: entry.amount,
			balance
		});
	}
	return { lines, charged, paid, balance };
}

export type LeaseBalance = {
	leaseId: string;
	charged: number;
	paid: number;
	/** charged − paid, including charges not due yet; positive = owed, negative = Guthaben. */
	balance: number;
	/**
	 * The Rückstand: charges due by `asOf` minus the payments made by `asOf`, at least 0. A month's
	 * rent before its due day, a correction dated later, a Nachzahlung before it is due (30 days
	 * after the statement reached the tenant), a CO₂ credit before its date and a payment dated
	 * later do not count yet.
	 */
	overdue: number;
	/** The last day by `asOf` money came in, null when nothing was paid by then. */
	lastPaymentDate: IsoDate | null;
	/**
	 * The month (of the due date) of the oldest due charge the payments do not cover: payments and
	 * due credits pay the oldest due charges first. Null when nothing is overdue.
	 */
	openSince: IsoMonth | null;
	/** The due date of that charge, null when nothing is overdue. */
	openSinceDate: IsoDate | null;
};

type BalanceCharge = { amount: number; dueDate: IsoDate | null };

/** What is overdue on `asOf` and since when, by FIFO over the due charges in due-date order. */
function overdueSince(
	charges: readonly BalanceCharge[],
	paid: number,
	asOf: IsoDate
): { overdue: number; openSince: IsoMonth | null; openSinceDate: IsoDate | null } {
	const due = charges
		.filter((charge): charge is { amount: number; dueDate: IsoDate } =>
			Boolean(charge.dueDate && charge.dueDate <= asOf)
		)
		.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
	// Credits (negative charges) count like payments: they settle the oldest debts.
	const available = due.reduce((sum, charge) => sum + Math.max(-charge.amount, 0), paid);
	let covered = 0;
	for (const charge of due) {
		if (charge.amount <= 0) continue;
		covered += charge.amount;
		if (covered > available) {
			const owed = due.reduce((sum, row) => sum + row.amount, 0) - paid;
			return {
				overdue: owed,
				openSince: monthOf(charge.dueDate),
				openSinceDate: charge.dueDate
			};
		}
	}
	return { overdue: 0, openSince: null, openSinceDate: null };
}

/**
 * The balance of every lease of the account, largest balance first. Charges are synced up to
 * `untilMonth` (default: the current month) before the sums are taken; `asOf` (default: today)
 * decides which charges are due and which payments are made for `overdue`, `openSince` and
 * `lastPaymentDate`. `leaseIds` narrows it to those leases (the tenant page).
 */
export async function listBalances(
	db: Database,
	accountId: string,
	options: { untilMonth?: IsoMonth; asOf?: IsoDate; leaseIds?: readonly string[] } = {}
): Promise<LeaseBalance[]> {
	const asOf = options.asOf ?? today();
	const leaseRows = await db
		.select({ id: leases.id })
		.from(leases)
		.where(eq(leases.accountId, accountId));
	const only = options.leaseIds && new Set(options.leaseIds);
	const leaseIds = leaseRows.map((row) => row.id).filter((id) => !only || only.has(id));
	await ensureCharges(db, accountId, leaseIds, options.untilMonth);

	const [chargeRows, paymentRows] = await Promise.all([
		db
			.select({
				leaseId: rentCharges.leaseId,
				dueDate: rentCharges.dueDate,
				amount: rentCharges.amount
			})
			.from(rentCharges)
			.where(eq(rentCharges.accountId, accountId)),
		db
			.select({ leaseId: payments.leaseId, date: payments.date, amount: payments.amount })
			.from(payments)
			.where(eq(payments.accountId, accountId))
	]);

	const chargesByLease = groupByLease(chargeRows);
	const paymentsByLease = groupByLease(paymentRows);
	const balances = leaseIds.map((leaseId): LeaseBalance => {
		// The balance takes every payment; the Rückstand and the last payment only those made by
		// asOf, so a payment dated later does not settle what is overdue today.
		// A refund to the tenant is owed again from its date, so for the Rückstand it counts as a
		// charge on that day rather than as less money received; the total stays the same, but
		// "offen seit" does not reach back to rent the refunded money had already settled.
		let paid = 0;
		let receivedByAsOf = 0;
		let lastPaymentDate: IsoDate | null = null;
		const refunds: BalanceCharge[] = [];
		for (const payment of paymentsByLease.get(leaseId) ?? []) {
			paid += payment.amount;
			if (payment.date > asOf) continue;
			if (payment.amount < 0) {
				refunds.push({ amount: -payment.amount, dueDate: payment.date });
				continue;
			}
			receivedByAsOf += payment.amount;
			if (payment.amount > 0 && (!lastPaymentDate || payment.date > lastPaymentDate)) {
				lastPaymentDate = payment.date;
			}
		}
		const charges = chargesByLease.get(leaseId) ?? [];
		const charged = charges.reduce((sum, charge) => sum + charge.amount, 0);
		return {
			leaseId,
			charged,
			paid,
			balance: charged - paid,
			...overdueSince([...charges, ...refunds], receivedByAsOf, asOf),
			lastPaymentDate
		};
	});
	return balances.sort((a, b) => b.balance - a.balance || a.leaseId.localeCompare(b.leaseId));
}

export type LedgerLineDetail =
	| { kind: 'charge'; chargeKind: RentChargeKind }
	| { kind: 'payment'; source: PaymentSource; bankTransactionId: string | null };

/**
 * What stands behind each ledger line, by line id: the kind of a charge, the source of a payment.
 * The ledger page decides with it which lines may be deleted (manual adjustments and payments)
 * and which ones belong to a bank transaction. Two selects, however many lines there are.
 */
export async function listLedgerLineDetails(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<Record<string, LedgerLineDetail>> {
	const [chargeRows, paymentRows] = await Promise.all([
		db
			.select({ id: rentCharges.id, kind: rentCharges.kind })
			.from(rentCharges)
			.where(and(eq(rentCharges.accountId, accountId), eq(rentCharges.leaseId, leaseId))),
		db
			.select({
				id: payments.id,
				source: payments.source,
				bankTransactionId: payments.bankTransactionId
			})
			.from(payments)
			.where(and(eq(payments.accountId, accountId), eq(payments.leaseId, leaseId)))
	]);
	const details: Record<string, LedgerLineDetail> = {};
	for (const row of chargeRows) details[row.id] = { kind: 'charge', chargeKind: row.kind };
	for (const row of paymentRows) {
		details[row.id] = {
			kind: 'payment',
			source: row.source,
			bankTransactionId: row.bankTransactionId
		};
	}
	return details;
}

/** The latest payment received on a lease, for "Wie letzte Zahlung" on the payment form. */
export type LastPayment = { date: IsoDate; amount: number; note: string | null };

/** The latest incoming payment of the lease (by date, then entry), refunds left out. One select. */
export async function lastPayment(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<LastPayment | undefined> {
	const [row] = await db
		.select({
			date: payments.date,
			amount: payments.amount,
			note: payments.note,
			source: payments.source
		})
		.from(payments)
		.where(
			and(eq(payments.accountId, accountId), eq(payments.leaseId, leaseId), gt(payments.amount, 0))
		)
		.orderBy(desc(payments.date), desc(payments.createdAt))
		.limit(1);
	if (!row) return undefined;
	// The note of a bank payment is the transfer's purpose ("Miete Oktober"), not one to repeat.
	return { date: row.date, amount: row.amount, note: row.source === 'manual' ? row.note : null };
}
