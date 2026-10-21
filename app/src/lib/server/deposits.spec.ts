import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatCents } from '../money';
import type { Database } from './db';
import { auditLog, depositTransactions } from './db/schema';
import {
	addDepositMovement,
	deleteDepositMovement,
	depositSummary,
	instalmentDeadlines,
	listDepositMovements,
	signedDepositAmount
} from './deposits';
import { createLease } from './leases';
import { contextA, contextB, leaseInput, seedLease, seedUnit, testDatabase } from './testing';

let db: Database;
let leaseId: string;
let foreignLeaseId: string;

/** The audit summaries about the deposit, in order. */
async function depositAudit(action: string) {
	const rows = await db.select().from(auditLog).where(eq(auditLog.action, action));
	return rows.map((entry) => entry.summary).filter((summary) => summary.startsWith('Kaution'));
}

beforeEach(async () => {
	db = await testDatabase();
	const { unitId } = await seedUnit(db, 'a');
	const { unitId: foreignUnit } = await seedUnit(db, 'b');
	// 600 € + 150 € + 50 € from 2025-01-01, deposit 1.800 €.
	const own = await createLease(db, contextA, leaseInput(unitId));
	const foreign = await createLease(db, contextB, leaseInput(foreignUnit));
	if (!own.ok || !foreign.ok) throw new Error('setup failed');
	leaseId = own.id;
	foreignLeaseId = foreign.id;
});

describe('signedDepositAmount', () => {
	it('adds received money and interest, takes returned and withheld money', () => {
		expect(signedDepositAmount('received', 60000)).toBe(60000);
		expect(signedDepositAmount('received', -60000)).toBe(60000);
		expect(signedDepositAmount('interest', 500)).toBe(500);
		expect(signedDepositAmount('returned', 50000)).toBe(-50000);
		expect(signedDepositAmount('withheld', -20000)).toBe(-20000);
	});
});

describe('depositSummary', () => {
	it('sums the kinds and works out what is held and still outstanding', () => {
		// Received 600 + 600 = 1.200, interest 5, returned 500, withheld 200:
		// held = 1.200 + 5 − 500 − 200 = 505; outstanding = 1.800 − 1.200 = 600.
		const summary = depositSummary(
			[
				{ kind: 'received', amount: 60000 },
				{ kind: 'received', amount: 60000 },
				{ kind: 'interest', amount: 500 },
				{ kind: 'returned', amount: -50000 },
				{ kind: 'withheld', amount: -20000 }
			],
			180000
		);
		expect(summary).toEqual({
			received: 120000,
			interest: 500,
			returned: 50000,
			withheld: 20000,
			held: 50500,
			outstanding: 60000
		});
	});

	it('never reports a negative outstanding amount', () => {
		expect(depositSummary([{ kind: 'received', amount: 200000 }], 180000).outstanding).toBe(0);
		expect(depositSummary([], 0)).toEqual({
			received: 0,
			interest: 0,
			returned: 0,
			withheld: 0,
			held: 0,
			outstanding: 0
		});
	});
});

describe('addDepositMovement and listDepositMovements', () => {
	it('books the movement with the sign of its kind and an audit line', async () => {
		const received = await addDepositMovement(db, contextA, {
			leaseId,
			date: '2025-01-03',
			kind: 'received',
			amount: 60000,
			note: 'erste Rate'
		});
		const returned = await addDepositMovement(db, contextA, {
			leaseId,
			date: '2026-02-01',
			kind: 'returned',
			amount: 40000
		});
		expect(received).toBeDefined();
		expect(returned).toBeDefined();

		const rows = await listDepositMovements(db, 'a', leaseId);
		expect(rows.map((row) => [row.id, row.date, row.kind, row.amount, row.note])).toEqual([
			[received, '2025-01-03', 'received', 60000, 'erste Rate'],
			[returned, '2026-02-01', 'returned', -40000, null]
		]);
		expect(rows[0]).toMatchObject({ accountId: 'a', leaseId });

		expect(await depositAudit('create')).toEqual([
			`Kaution erhalten: ${formatCents(60000)} vom 03.01.2025 gebucht`,
			`Kaution zurückgezahlt: ${formatCents(40000)} vom 01.02.2026 gebucht`
		]);
	});

	it('does not book on a lease of another account, and does not leak into it', async () => {
		expect(
			await addDepositMovement(db, contextA, {
				leaseId: foreignLeaseId,
				date: '2025-01-03',
				kind: 'received',
				amount: 60000
			})
		).toBeUndefined();
		await addDepositMovement(db, contextA, {
			leaseId,
			date: '2025-01-03',
			kind: 'received',
			amount: 60000
		});
		expect(await listDepositMovements(db, 'b', leaseId)).toEqual([]);
		expect(await listDepositMovements(db, 'b', foreignLeaseId)).toEqual([]);
		expect(await db.select().from(depositTransactions)).toHaveLength(1);
	});
});

describe('deleteDepositMovement', () => {
	it('deletes a movement booked by hand and logs it', async () => {
		const id = await addDepositMovement(db, contextA, {
			leaseId,
			date: '2025-01-03',
			kind: 'received',
			amount: 60000
		});
		expect(await deleteDepositMovement(db, contextA, leaseId, id!)).toBe('deleted');
		expect(await listDepositMovements(db, 'a', leaseId)).toEqual([]);
		expect(await depositAudit('delete')).toEqual([
			`Kaution erhalten: ${formatCents(60000)} vom 03.01.2025 gelöscht`
		]);
	});

	it('does not delete a movement of another account', async () => {
		const id = await addDepositMovement(db, contextB, {
			leaseId: foreignLeaseId,
			date: '2025-01-03',
			kind: 'received',
			amount: 60000
		});
		expect(await deleteDepositMovement(db, contextA, foreignLeaseId, id!)).toBe('missing');
		expect(await listDepositMovements(db, 'b', foreignLeaseId)).toHaveLength(1);
	});

	it('does not delete a movement of another lease of the account', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const otherLeaseId = await seedLease(db, 'a', unitId);
		const id = await addDepositMovement(db, contextA, {
			leaseId: otherLeaseId,
			date: '2025-01-03',
			kind: 'received',
			amount: 60000
		});
		expect(await deleteDepositMovement(db, contextA, leaseId, id!)).toBe('missing');
		expect(await listDepositMovements(db, 'a', otherLeaseId)).toHaveLength(1);
	});
});

describe('instalmentDeadlines', () => {
	it('puts the three instalments on the first three rent due dates', async () => {
		// Third working days: Mon 6 Jan (Neujahr does not count), Wed 5 Feb, Wed 5 Mar 2025;
		// 1.800 € / 3 = 600 € each.
		expect(await instalmentDeadlines(db, 'a', leaseId)).toEqual([
			{ dueDate: '2025-01-06', amount: 60000 },
			{ dueDate: '2025-02-05', amount: 60000 },
			{ dueDate: '2025-03-05', amount: 60000 }
		]);
	});

	it('splits an odd deposit to the cent and ignores the ledger start', async () => {
		const { unitId } = await seedUnit(db, 'a', { name: 'OG' });
		const result = await createLease(
			db,
			contextA,
			leaseInput(unitId, {
				startDate: '2024-06-15',
				ledgerStart: '2026-01-01',
				securityDeposit: 100000
			})
		);
		if (!result.ok) throw new Error('setup failed');
		// Third working days: Wed 5 Jun, Wed 3 Jul, Mon 5 Aug 2024. The first instalment is due at
		// the start of the tenancy (§ 551 Abs. 2 BGB), so 5 June becomes the start date, 15 June.
		// 1.000,00 € over three: 333,34 + 333,33 + 333,33 (largest remainder, first index wins).
		expect(await instalmentDeadlines(db, 'a', result.id)).toEqual([
			{ dueDate: '2024-06-15', amount: 33334 },
			{ dueDate: '2024-07-03', amount: 33333 },
			{ dueDate: '2024-08-05', amount: 33333 }
		]);
	});

	it('is empty for commercial leases, leases without a deposit and foreign leases', async () => {
		const { unitId } = await seedUnit(db, 'a', { name: 'Laden' });
		const commercial = await createLease(db, contextA, leaseInput(unitId, { kind: 'commercial' }));
		const { unitId: other } = await seedUnit(db, 'a', { name: 'DG' });
		const free = await createLease(db, contextA, leaseInput(other, { securityDeposit: 0 }));
		if (!commercial.ok || !free.ok) throw new Error('setup failed');
		expect(await instalmentDeadlines(db, 'a', commercial.id)).toEqual([]);
		expect(await instalmentDeadlines(db, 'a', free.id)).toEqual([]);
		expect(await instalmentDeadlines(db, 'a', foreignLeaseId)).toEqual([]);
	});
});
