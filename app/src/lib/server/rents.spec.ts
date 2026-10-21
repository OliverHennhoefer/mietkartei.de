import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { rentChanges } from './db/schema';
import { createLease } from './leases';
import { listRentChanges, rentOnDate } from './rents';
import { contextA, contextB, leaseInput, seedUnit, testDatabase } from './testing';

let db: Database;
let leaseId: string;
let foreignLeaseId: string;

beforeEach(async () => {
	db = await testDatabase();
	const { unitId } = await seedUnit(db, 'a');
	const { unitId: foreignUnit } = await seedUnit(db, 'b');
	const own = await createLease(db, contextA, leaseInput(unitId, { startDate: '2025-01-01' }));
	const foreign = await createLease(db, contextB, leaseInput(foreignUnit));
	if (!own.ok || !foreign.ok) throw new Error('setup failed');
	leaseId = own.id;
	foreignLeaseId = foreign.id;
});

describe('listRentChanges', () => {
	it('starts with the initial rent of the lease', async () => {
		const history = await listRentChanges(db, 'a', leaseId);
		expect(history.map((change) => [change.validFrom, change.baseRent, change.reason])).toEqual([
			['2025-01-01', 60000, 'initial']
		]);
	});
});

describe('rentOnDate', () => {
	it('returns the change valid on the day', async () => {
		await db.insert(rentChanges).values({
			accountId: 'a',
			leaseId,
			validFrom: '2026-01-01',
			baseRent: 65000,
			reason: 'manual'
		});
		expect(await rentOnDate(db, 'a', leaseId, '2024-12-31')).toBeUndefined();
		expect((await rentOnDate(db, 'a', leaseId, '2025-06-15'))?.baseRent).toBe(60000);
		expect((await rentOnDate(db, 'a', leaseId, '2026-01-01'))?.baseRent).toBe(65000);
	});

	it('ignores proposed changes', async () => {
		await db.insert(rentChanges).values({
			accountId: 'a',
			leaseId,
			validFrom: '2025-06-01',
			baseRent: 70000,
			reason: 'indexed',
			status: 'proposed'
		});
		expect((await rentOnDate(db, 'a', leaseId, '2025-07-01'))?.baseRent).toBe(60000);
	});

	it('does not read the history of another account', async () => {
		expect(await rentOnDate(db, 'a', foreignLeaseId, '2025-06-15')).toBeUndefined();
		expect(await listRentChanges(db, 'a', foreignLeaseId)).toEqual([]);
	});
});
