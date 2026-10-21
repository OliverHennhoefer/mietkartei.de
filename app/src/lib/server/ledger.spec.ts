import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatCents } from '../money';
import type { Database } from './db';
import { auditLog, leases, payments, rentCharges, rentChanges } from './db/schema';
import { createLease } from './leases';
import {
	createPayment,
	deleteCharge,
	deletePayment,
	ensureCharges,
	listBalances,
	listLedger,
	postCharge
} from './ledger';
import { contextA, contextB, leaseInput, seedUnit, testDatabase } from './testing';

let db: Database;
let unitId: string;
let leaseId: string;
let foreignLeaseId: string;

beforeEach(async () => {
	db = await testDatabase();
	({ unitId } = await seedUnit(db, 'a'));
	const { unitId: foreignUnit } = await seedUnit(db, 'b');
	// 600 € + 150 € + 50 € from 2025-01-01, due on the third working day (Neujahr skipped).
	const own = await createLease(db, contextA, leaseInput(unitId));
	const foreign = await createLease(db, contextB, leaseInput(foreignUnit));
	if (!own.ok || !foreign.ok) throw new Error('setup failed');
	leaseId = own.id;
	foreignLeaseId = foreign.id;
});

/** The rent rows of a lease in month order: [period, amount, dueDate]. */
async function rentRows(id: string) {
	return db
		.select()
		.from(rentCharges)
		.where(eq(rentCharges.leaseId, id))
		.orderBy(asc(rentCharges.period), asc(rentCharges.kind));
}

const adjustment = {
	kind: 'adjustment' as const,
	period: '2025-05',
	dueDate: '2025-05-05',
	amount: -5000,
	note: 'Mietminderung Heizung'
};

describe('ensureCharges', () => {
	it('inserts one rent charge per month up to untilMonth, and nothing twice', async () => {
		expect(await ensureCharges(db, 'a', [leaseId], '2025-04')).toEqual({
			inserted: 4,
			updated: 0,
			removed: 0
		});
		const rows = await rentRows(leaseId);
		expect(rows.map((row) => [row.period, row.amount, row.dueDate, row.kind])).toEqual([
			['2025-01', 80000, '2025-01-06', 'rent'],
			['2025-02', 80000, '2025-02-05', 'rent'],
			['2025-03', 80000, '2025-03-05', 'rent'],
			['2025-04', 80000, '2025-04-03', 'rent']
		]);
		expect(rows[0]).toMatchObject({
			accountId: 'a',
			baseRent: 60000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000
		});

		expect(await ensureCharges(db, 'a', [leaseId, leaseId], '2025-04')).toEqual({
			inserted: 0,
			updated: 0,
			removed: 0
		});
		expect((await rentRows(leaseId)).map((row) => row.id)).toEqual(rows.map((row) => row.id));
		// Derived data: no audit lines beyond the lease creation.
		expect(await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'))).toHaveLength(1);
	});

	it('updates the months after a backdated rent change and keeps their ids', async () => {
		await ensureCharges(db, 'a', [leaseId], '2025-04');
		const before = await rentRows(leaseId);
		await db.insert(rentChanges).values({
			accountId: 'a',
			leaseId,
			validFrom: '2025-02-01',
			baseRent: 65000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			reason: 'manual',
			status: 'approved'
		});

		expect(await ensureCharges(db, 'a', [leaseId], '2025-04')).toEqual({
			inserted: 0,
			updated: 3,
			removed: 0
		});
		const after = await rentRows(leaseId);
		expect(after.map((row) => [row.period, row.baseRent, row.amount])).toEqual([
			['2025-01', 60000, 80000],
			['2025-02', 65000, 85000],
			['2025-03', 65000, 85000],
			['2025-04', 65000, 85000]
		]);
		expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
	});

	it('removes the rent rows after a new end date but leaves other postings alone', async () => {
		await ensureCharges(db, 'a', [leaseId], '2025-06');
		const posted = await postCharge(db, contextA, { leaseId, ...adjustment });
		await db.update(leases).set({ endDate: '2025-03-15' }).where(eq(leases.id, leaseId));

		expect(await ensureCharges(db, 'a', [leaseId], '2025-06')).toEqual({
			inserted: 0,
			updated: 1,
			removed: 3
		});
		// March: 15 of 31 days: 600 × 15/31 = 290,32; 150 × 15/31 = 72,58; 50 × 15/31 = 24,19.
		expect((await rentRows(leaseId)).map((row) => [row.period, row.kind, row.amount])).toEqual([
			['2025-01', 'rent', 80000],
			['2025-02', 'rent', 80000],
			['2025-03', 'rent', 38709],
			['2025-05', 'adjustment', -5000]
		]);
		const [kept] = await db.select().from(rentCharges).where(eq(rentCharges.id, posted!));
		expect(kept).toMatchObject({ kind: 'adjustment', note: 'Mietminderung Heizung' });
	});

	it('keeps rows within the term that lie beyond a shorter horizon', async () => {
		await ensureCharges(db, 'a', [leaseId], '2025-06');
		expect(await ensureCharges(db, 'a', [leaseId], '2025-02')).toEqual({
			inserted: 0,
			updated: 0,
			removed: 0
		});
		expect(await rentRows(leaseId)).toHaveLength(6);
	});

	it('starts at the ledger start of a lease entered late', async () => {
		const late = await createLease(
			db,
			contextA,
			leaseInput(unitId, { startDate: '2015-04-01', ledgerStart: '2025-03-01' })
		);
		if (!late.ok) throw new Error('setup failed');
		expect(await ensureCharges(db, 'a', [late.id], '2025-04')).toEqual({
			inserted: 2,
			updated: 0,
			removed: 0
		});
		expect((await rentRows(late.id)).map((row) => [row.period, row.amount])).toEqual([
			['2025-03', 80000],
			['2025-04', 80000]
		]);
	});

	it('changes nothing for leases of another account', async () => {
		expect(await ensureCharges(db, 'a', [foreignLeaseId], '2025-03')).toEqual({
			inserted: 0,
			updated: 0,
			removed: 0
		});
		expect(await rentRows(foreignLeaseId)).toEqual([]);
		// The lease itself is fine; only the account was wrong.
		expect(await ensureCharges(db, 'b', [foreignLeaseId], '2025-03')).toMatchObject({
			inserted: 3
		});
		expect(await ensureCharges(db, 'a', [], '2025-03')).toEqual({
			inserted: 0,
			updated: 0,
			removed: 0
		});
	});
});

describe('postCharge and deleteCharge', () => {
	it('posts an adjustment with an audit line and deletes it again', async () => {
		const id = await postCharge(db, contextA, { leaseId, ...adjustment });
		expect(id).toBeDefined();
		const [row] = await db.select().from(rentCharges).where(eq(rentCharges.id, id!));
		expect(row).toMatchObject({
			accountId: 'a',
			leaseId,
			kind: 'adjustment',
			period: '2025-05',
			dueDate: '2025-05-05',
			amount: -5000,
			baseRent: 0,
			note: 'Mietminderung Heizung'
		});

		expect(await deleteCharge(db, contextA, id!)).toBe(true);
		expect(await db.select().from(rentCharges)).toEqual([]);
		const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, leaseId));
		expect(audit.map((entry) => [entry.action, entry.summary])).toEqual([
			['create', 'Mietvertrag angelegt'],
			['post', `Korrektur Mai 2025 als Gutschrift über ${formatCents(5000)} gebucht`],
			['delete', `Korrektur Mai 2025 als Gutschrift über ${formatCents(5000)} gelöscht`]
		]);
	});

	it('refuses a lease or a charge of another account', async () => {
		expect(await postCharge(db, contextA, { leaseId: foreignLeaseId, ...adjustment })).toBe(
			undefined
		);
		expect(await db.select().from(rentCharges)).toEqual([]);

		const foreign = await postCharge(db, contextB, { leaseId: foreignLeaseId, ...adjustment });
		expect(await deleteCharge(db, contextA, foreign!)).toBe(false);
		expect(await db.select().from(rentCharges)).toHaveLength(1);
		expect(await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'))).toHaveLength(1);
	});

	it('never deletes rent rows', async () => {
		await ensureCharges(db, 'a', [leaseId], '2025-01');
		const [rent] = await rentRows(leaseId);
		expect(await deleteCharge(db, contextA, rent.id)).toBe(false);
		expect(await rentRows(leaseId)).toHaveLength(1);
	});
});

describe('createPayment and deletePayment', () => {
	const payment = { leaseId: '', date: '2025-04-03', amount: 65000 };

	it('books a payment with an audit line and deletes it again', async () => {
		const id = await createPayment(db, contextA, { ...payment, leaseId, note: 'Überweisung' });
		expect(id).toBeDefined();
		const [row] = await db.select().from(payments).where(eq(payments.id, id!));
		expect(row).toMatchObject({
			accountId: 'a',
			leaseId,
			date: '2025-04-03',
			amount: 65000,
			note: 'Überweisung'
		});

		expect(await deletePayment(db, contextA, id!)).toBe(true);
		expect(await db.select().from(payments)).toEqual([]);
		const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, leaseId));
		expect(audit.map((entry) => [entry.action, entry.summary])).toEqual([
			['create', 'Mietvertrag angelegt'],
			['create', `Zahlung ${formatCents(65000)} vom 03.04.2025 gebucht`],
			['delete', `Zahlung ${formatCents(65000)} vom 03.04.2025 gelöscht`]
		]);
	});

	it('calls a negative amount a refund', async () => {
		await createPayment(db, contextA, { ...payment, leaseId, amount: -2500 });
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'create'));
		expect(audit.at(-1)?.summary).toBe(`Rückzahlung ${formatCents(2500)} vom 03.04.2025 gebucht`);
	});

	it('refuses a lease or a payment of another account', async () => {
		expect(await createPayment(db, contextA, { ...payment, leaseId: foreignLeaseId })).toBe(
			undefined
		);
		expect(await db.select().from(payments)).toEqual([]);

		const foreign = await createPayment(db, contextB, { ...payment, leaseId: foreignLeaseId });
		expect(await deletePayment(db, contextA, foreign!)).toBe(false);
		expect(await db.select().from(payments)).toHaveLength(1);
		expect(await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'))).toHaveLength(1);
	});
});

describe('listLedger', () => {
	let endedLeaseId: string;

	beforeEach(async () => {
		// Ends in March, so the sync up to the current month stops there whatever today is.
		const ended = await createLease(db, contextA, leaseInput(unitId, { endDate: '2025-03-31' }));
		if (!ended.ok) throw new Error('setup failed');
		endedLeaseId = ended.id;
		const pay = (date: string, amount: number, note: string | null = null) =>
			createPayment(db, contextA, { leaseId: endedLeaseId, date, amount, note });
		await pay('2025-03-05', 100000, 'Nachzahlung');
		await pay('2025-01-03', 80000);
		await pay('2025-02-10', 50000);
	});

	it('interleaves charges and payments with a running balance, charges first on a day', async () => {
		// January's rent is due on Monday 06.01. (Neujahr), after the payment of 03.01.
		const ledger = await listLedger(db, 'a', endedLeaseId);
		expect(
			ledger.lines.map((line) => [line.date, line.kind, line.label, line.amount, line.balance])
		).toEqual([
			['2025-01-03', 'payment', 'Zahlung', 80000, -80000],
			['2025-01-06', 'charge', 'Miete Januar 2025', 80000, 0],
			['2025-02-05', 'charge', 'Miete Februar 2025', 80000, 80000],
			['2025-02-10', 'payment', 'Zahlung', 50000, 30000],
			['2025-03-05', 'charge', 'Miete März 2025', 80000, 110000],
			['2025-03-05', 'payment', 'Nachzahlung', 100000, 10000]
		]);
		expect(ledger).toMatchObject({ charged: 240000, paid: 230000, balance: 10000 });
	});

	it('limits the lines to a window and carries the balance over', async () => {
		const ledger = await listLedger(db, 'a', endedLeaseId, {
			from: '2025-02-01',
			to: '2025-02-28'
		});
		expect(ledger.lines.map((line) => [line.date, line.kind, line.balance])).toEqual([
			['2025-02-05', 'charge', 80000],
			['2025-02-10', 'payment', 30000]
		]);
		expect(ledger).toMatchObject({ charged: 80000, paid: 50000, balance: 30000 });
	});

	it('labels other postings by kind and note', async () => {
		await postCharge(db, contextA, { leaseId: endedLeaseId, ...adjustment, period: '2025-03' });
		const ledger = await listLedger(db, 'a', endedLeaseId, { from: '2025-05-01' });
		expect(ledger.lines.map((line) => [line.label, line.amount, line.balance])).toEqual([
			['Korrektur März 2025: Mietminderung Heizung', -5000, 5000]
		]);
	});

	it('shows nothing for a lease of another account and generates no charges for it', async () => {
		expect(await listLedger(db, 'a', foreignLeaseId)).toEqual({
			lines: [],
			charged: 0,
			paid: 0,
			balance: 0
		});
		expect(await rentRows(foreignLeaseId)).toEqual([]);
	});
});

describe('listBalances', () => {
	it('reports balance, last payment and the first open month of every lease, arrears first', async () => {
		// Lease 1: three months, 1.300 € paid of 2.400 €: January is covered, February not.
		await db.update(leases).set({ endDate: '2025-03-31' }).where(eq(leases.id, leaseId));
		await createPayment(db, contextA, {
			leaseId,
			date: '2025-01-03',
			amount: 80000
		});
		await createPayment(db, contextA, {
			leaseId,
			date: '2025-02-10',
			amount: 50000
		});
		// Lease 2: two months, nothing paid.
		const unpaid = await createLease(db, contextA, leaseInput(unitId, { endDate: '2025-02-28' }));
		// Lease 3: one month, overpaid.
		const overpaid = await createLease(db, contextA, leaseInput(unitId, { endDate: '2025-01-31' }));
		if (!unpaid.ok || !overpaid.ok) throw new Error('setup failed');
		await createPayment(db, contextA, {
			leaseId: overpaid.id,
			date: '2025-01-02',
			amount: 100000
		});
		await createPayment(db, contextB, {
			leaseId: foreignLeaseId,
			date: '2025-01-02',
			amount: 100000
		});

		expect(await listBalances(db, 'a', { untilMonth: '2025-03' })).toEqual([
			{
				leaseId: unpaid.id,
				charged: 160000,
				paid: 0,
				balance: 160000,
				overdue: 160000,
				lastPaymentDate: null,
				openSince: '2025-01'
			},
			{
				leaseId,
				charged: 240000,
				paid: 130000,
				balance: 110000,
				overdue: 110000,
				lastPaymentDate: '2025-02-10',
				openSince: '2025-02'
			},
			{
				leaseId: overpaid.id,
				charged: 80000,
				paid: 100000,
				balance: -20000,
				overdue: 0,
				lastPaymentDate: '2025-01-02',
				openSince: null
			}
		]);
		expect(await rentRows(foreignLeaseId)).toEqual([]);
	});

	/** Pays every month's 800 € rent of `months` in full on the 10th. */
	async function payRents(id: string, months: string[]) {
		for (const month of months) {
			await createPayment(db, contextA, {
				leaseId: id,
				date: `${month}-10`,
				amount: 80000
			});
		}
	}

	const months2025 = Array.from(
		{ length: 12 },
		(_, index) => `2025-${String(index + 1).padStart(2, '0')}`
	);

	it('reference scenario: EG of Lindenstraße 4 pays 11 of 12 rents, Teilzahlung in December', async () => {
		// EG: 600 + 150 + 50 = 800 € a month all year 2025. Paid January to November in full and
		// 500 € in December. Charged 12 × 800 = 9.600 €, paid 11 × 800 + 500 = 9.300 €, so
		// 300 € are open, all of them from December (FIFO).
		const { unitId: eg } = await seedUnit(db, 'a', { name: 'EG' });
		const lease = await createLease(db, contextA, leaseInput(eg));
		if (!lease.ok) throw new Error('setup failed');
		await payRents(lease.id, months2025.slice(0, 11));
		await createPayment(db, contextA, {
			leaseId: lease.id,
			date: '2025-12-10',
			amount: 50000,
			note: 'Teilzahlung'
		});

		const balances = await listBalances(db, 'a', { untilMonth: '2025-12', asOf: '2025-12-31' });
		expect(balances.find((row) => row.leaseId === lease.id)).toEqual({
			leaseId: lease.id,
			charged: 960000,
			paid: 930000,
			balance: 30000,
			overdue: 30000,
			lastPaymentDate: '2025-12-10',
			openSince: '2025-12'
		});

		const ledger = await listLedger(db, 'a', lease.id, { to: '2025-12-31' });
		expect(ledger).toMatchObject({ charged: 960000, paid: 930000, balance: 30000 });
		expect(ledger.lines).toHaveLength(24);
		// December: the rent (due 03.12.) brings the balance to 800 €, the Teilzahlung to 300 €.
		expect(ledger.lines.slice(-2).map((line) => [line.date, line.label, line.balance])).toEqual([
			['2025-12-03', 'Miete Dezember 2025', 80000],
			['2025-12-10', 'Teilzahlung', 30000]
		]);
	});

	it('counts a posting as Rückstand only from its due date', async () => {
		// A correction of 200 € for period 2025-12 is due on 01.04.2026. Every rent from January
		// 2025 to March 2026 is paid.
		await payRents(leaseId, [...months2025, '2026-01', '2026-02', '2026-03']);
		await postCharge(db, contextA, {
			leaseId,
			kind: 'adjustment',
			period: '2025-12',
			dueDate: '2026-04-01',
			amount: 20000,
			note: 'Nachberechnung'
		});

		// On 20.03.2026: 15 × 800 + 200 = 12.200 € charged, 15 × 800 = 12.000 € paid. The 200 € are
		// owed but not due: no Rückstand, nothing open (not "offen seit Dezember 2025").
		const [march] = (
			await listBalances(db, 'a', { untilMonth: '2026-03', asOf: '2026-03-20' })
		).filter((row) => row.leaseId === leaseId);
		expect(march).toMatchObject({
			charged: 1220000,
			paid: 1200000,
			balance: 20000,
			overdue: 0,
			openSince: null
		});

		// On 02.04.2026 the correction is due, April's rent not yet: it is due on Tuesday 07.04.,
		// after Karfreitag and Ostermontag. 200 € overdue since April 2026, the month it fell due.
		const [april] = (
			await listBalances(db, 'a', { untilMonth: '2026-04', asOf: '2026-04-02' })
		).filter((row) => row.leaseId === leaseId);
		expect(april).toMatchObject({
			charged: 1300000,
			paid: 1200000,
			balance: 100000,
			overdue: 20000,
			openSince: '2026-04'
		});
		const [easter] = (
			await listBalances(db, 'a', { untilMonth: '2026-04', asOf: '2026-04-06' })
		).filter((row) => row.leaseId === leaseId);
		expect(easter).toMatchObject({ overdue: 20000 });
		const [due] = (
			await listBalances(db, 'a', { untilMonth: '2026-04', asOf: '2026-04-07' })
		).filter((row) => row.leaseId === leaseId);
		expect(due).toMatchObject({ overdue: 100000 });
	});

	it('counts the rent of the month only from its due day', async () => {
		// January 2025: Neujahr does not count, so the rent is due on Monday 06.01. Paid nothing.
		// On Friday 03.01. it is owed but not due.
		await db.update(leases).set({ endDate: '2025-01-31' }).where(eq(leases.id, leaseId));
		const before = await listBalances(db, 'a', { untilMonth: '2025-01', asOf: '2025-01-03' });
		expect(before.find((row) => row.leaseId === leaseId)).toMatchObject({
			balance: 80000,
			overdue: 0,
			openSince: null
		});
		const after = await listBalances(db, 'a', { untilMonth: '2025-01', asOf: '2025-01-06' });
		expect(after.find((row) => row.leaseId === leaseId)).toMatchObject({
			balance: 80000,
			overdue: 80000,
			openSince: '2025-01'
		});
	});

	it('moves "offen seit" on when a credit settles the oldest open charge', async () => {
		// January: rent 800 € (due 06.01.) paid; a correction of +300 € due 20.01. not paid.
		// February: a credit of −300 € (due 01.02.) and the rent of 800 € (due 05.02.), not paid.
		// The credit settles January's 300 €, so February's rent is the oldest open charge:
		// overdue = 800 + 300 − 300 + 800 − 800 = 800 €, open since February.
		await db.update(leases).set({ endDate: '2025-02-28' }).where(eq(leases.id, leaseId));
		await payRents(leaseId, ['2025-01']);
		await postCharge(db, contextA, {
			leaseId,
			kind: 'adjustment',
			period: '2025-01',
			dueDate: '2025-01-20',
			amount: 30000,
			note: 'Nachberechnung'
		});
		await postCharge(db, contextA, {
			leaseId,
			kind: 'adjustment',
			period: '2025-02',
			dueDate: '2025-02-01',
			amount: -30000,
			note: 'Gutschrift'
		});
		const balances = await listBalances(db, 'a', { untilMonth: '2025-02', asOf: '2025-02-28' });
		expect(balances.find((row) => row.leaseId === leaseId)).toMatchObject({
			charged: 160000,
			paid: 80000,
			balance: 80000,
			overdue: 80000,
			openSince: '2025-02'
		});
	});
});
