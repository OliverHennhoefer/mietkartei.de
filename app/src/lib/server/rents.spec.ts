import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { auditLog, rentChanges } from './db/schema';
import { createLease } from './leases';
import { addRentChange, deleteRentChange, listRentChanges, rentOnDate } from './rents';
import { contextA, contextB, leaseInput, seedUnit, testDatabase } from './testing';

let db: Database;
let leaseId: string;
let foreignLeaseId: string;

const increase = {
	validFrom: '2026-01-01',
	baseRent: 65000,
	operatingCostPrepayment: 16000,
	heatingCostPrepayment: 5000,
	reason: 'manual' as const,
	note: 'Einvernehmlich erhöht.'
};

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

describe('addRentChange', () => {
	it('appends an approved change and logs it', async () => {
		const id = await addRentChange(db, contextA, leaseId, increase);
		expect(id).toBeDefined();

		const history = await listRentChanges(db, 'a', leaseId);
		expect(history.map((change) => [change.validFrom, change.baseRent, change.reason])).toEqual([
			['2025-01-01', 60000, 'initial'],
			['2026-01-01', 65000, 'manual']
		]);
		expect(history[1]).toMatchObject({
			id,
			accountId: 'a',
			status: 'approved',
			note: 'Einvernehmlich erhöht.',
			createdBy: 'user-a'
		});

		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'update'));
		expect(audit.map((entry) => entry.summary)).toEqual(['Miete ab 2026-01-01 geändert']);
	});

	it('refuses a lease of another account', async () => {
		expect(await addRentChange(db, contextA, foreignLeaseId, increase)).toBeUndefined();
		expect(await listRentChanges(db, 'b', foreignLeaseId)).toHaveLength(1);
	});
});

describe('rentOnDate', () => {
	it('returns the change valid on the day', async () => {
		await addRentChange(db, contextA, leaseId, increase);
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

describe('deleteRentChange', () => {
	it('deletes a later change but never the initial one', async () => {
		const id = await addRentChange(db, contextA, leaseId, increase);
		const [initial] = await listRentChanges(db, 'a', leaseId);

		expect(await deleteRentChange(db, contextA, initial.id)).toBe(false);
		expect(await deleteRentChange(db, contextA, id!)).toBe(true);
		expect((await listRentChanges(db, 'a', leaseId)).map((change) => change.reason)).toEqual([
			'initial'
		]);
	});

	it('does not delete a change of another account', async () => {
		const id = await addRentChange(db, contextB, foreignLeaseId, increase);
		expect(await deleteRentChange(db, contextA, id!)).toBe(false);
		expect(await listRentChanges(db, 'b', foreignLeaseId)).toHaveLength(2);
	});
});
