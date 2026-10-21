import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { createLease } from './leases';
import { createPayment, listLedgerLineDetails, postCharge } from './ledger';
import { contextA, contextB, leaseInput, seedUnit, testDatabase } from './testing';

// listLedgerLineDetails is the ledger page's addition to ledger.ts; the rest is covered by
// ledger.spec.ts.

let db: Database;
let leaseId: string;
let foreignLeaseId: string;

beforeEach(async () => {
	db = await testDatabase();
	const { unitId } = await seedUnit(db, 'a');
	const { unitId: foreignUnit } = await seedUnit(db, 'b');
	const own = await createLease(db, contextA, leaseInput(unitId));
	const foreign = await createLease(db, contextB, leaseInput(foreignUnit));
	if (!own.ok || !foreign.ok) throw new Error('setup failed');
	leaseId = own.id;
	foreignLeaseId = foreign.id;
});

describe('listLedgerLineDetails', () => {
	it('tells the kind of each charge and which lines are payments', async () => {
		const adjustment = await postCharge(db, contextA, {
			leaseId,
			kind: 'adjustment',
			period: '2025-01',
			dueDate: '2025-01-01',
			amount: 10000,
			note: 'Anfangssaldo'
		});
		const payment = await createPayment(db, contextA, {
			leaseId,
			date: '2025-02-03',
			amount: 80000
		});
		const details = await listLedgerLineDetails(db, 'a', leaseId);
		expect(details[adjustment!]).toEqual({ kind: 'charge', chargeKind: 'adjustment' });
		expect(details[payment!]).toEqual({ kind: 'payment' });
		expect(Object.keys(details)).toHaveLength(2);
	});

	it('does not leak into another account', async () => {
		const foreign = await createPayment(db, contextB, {
			leaseId: foreignLeaseId,
			date: '2025-02-03',
			amount: 80000
		});
		expect(foreign).toBeDefined();
		expect(await listLedgerLineDetails(db, 'a', foreignLeaseId)).toEqual({});
		expect(await listLedgerLineDetails(db, 'b', leaseId)).toEqual({});
	});
});
