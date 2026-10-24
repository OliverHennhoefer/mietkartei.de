import { beforeEach, describe, expect, it } from 'vitest';
import {
	archiveProperty,
	archiveTenant,
	propertyArchiving,
	restoreProperty,
	restoreTenant,
	tenantArchiving
} from './archive';
import type { Database } from './db';
import { createLease, getLease, leaseInputOf, listUnitsWithProperty, updateLease } from './leases';
import { listProperties, propertyOverview } from './properties';
import { listTenants } from './tenants';
import {
	contextA,
	contextB,
	integrityProblems,
	leaseInput,
	seedLease,
	seedTenant,
	seedUnit,
	testDatabase
} from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

describe('properties', () => {
	it('waits for every lease on its units to end, extra units and later starts too', async () => {
		const sold = await seedUnit(db, 'a', { propertyName: 'Verkauft' });
		const parking = await seedUnit(db, 'a', { name: 'Stellplatz', propertyName: 'Hof' });
		const main = await seedLease(db, 'a', sold.unitId, { endDate: '2025-06-30' });
		await seedLease(db, 'a', parking.unitId, { startDate: '2025-08-01' });

		// On 2025-06-30 the lease still runs; from July on the property is free.
		const running = await propertyArchiving(db, 'a', sold.propertyId, '2025-06-30');
		expect(running?.runningLeases.map((link) => link.href)).toEqual([`/vertraege/${main}`]);
		expect(await archiveProperty(db, contextA, sold.propertyId, '2025-06-30')).toBe('in-use');
		expect(await archiveProperty(db, contextA, sold.propertyId, '2025-07-01')).toBe('archived');

		// A lease that starts later keeps the property in use, here as extra unit of another lease.
		const other = await seedUnit(db, 'a', { propertyName: 'Nebenan' });
		await seedLease(db, 'a', other.unitId, {
			startDate: '2025-09-01',
			extraUnitIds: [parking.unitId]
		});
		expect(await archiveProperty(db, contextA, parking.propertyId, '2025-07-01')).toBe('in-use');
	});

	it('hides an archived property from lists and selects and takes no new lease', async () => {
		const sold = await seedUnit(db, 'a', { propertyName: 'Verkauft' });
		const kept = await seedUnit(db, 'a', { propertyName: 'Behalten' });
		const leaseId = await seedLease(db, 'a', sold.unitId, { endDate: '2025-06-30' });
		expect(await archiveProperty(db, contextA, sold.propertyId, '2025-07-01')).toBe('archived');

		expect((await listProperties(db, 'a')).map((row) => row.id)).toEqual([kept.propertyId]);
		expect(await listProperties(db, 'a', { archived: true })).toHaveLength(2);
		expect((await listUnitsWithProperty(db, 'a')).map((row) => row.unit.id)).toEqual([kept.unitId]);
		const overview = await propertyOverview(db, 'a', '2025-07-01');
		expect(overview.find((row) => row.id === sold.propertyId)?.archivedAt).toBe('2025-07-01');

		expect(await createLease(db, contextA, leaseInput(sold.unitId))).toEqual({
			ok: false,
			reason: 'archived'
		});
		expect(
			await createLease(db, contextA, leaseInput(kept.unitId, { extraUnitIds: [sold.unitId] }))
		).toEqual({ ok: false, reason: 'archived' });

		// The old lease still saves, e.g. to correct its end.
		const lease = await getLease(db, 'a', leaseId);
		expect(
			await updateLease(db, contextA, leaseId, { ...leaseInputOf(lease!), endDate: '2025-06-15' })
		).toEqual({ ok: true });

		expect(await restoreProperty(db, contextA, sold.propertyId)).toBe(true);
		expect(await listProperties(db, 'a')).toHaveLength(2);
		expect((await createLease(db, contextA, leaseInput(sold.unitId))).ok).toBe(true);
		expect(await integrityProblems(db)).toEqual([]);
	});

	it('does not archive or restore a property of another account', async () => {
		const { propertyId } = await seedUnit(db, 'b');
		expect(await archiveProperty(db, contextA, propertyId, '2025-07-01')).toBe('missing');
		expect(await restoreProperty(db, contextA, propertyId)).toBe(false);
		expect(await archiveProperty(db, contextB, propertyId, '2025-07-01')).toBe('archived');
		expect(await listProperties(db, 'b')).toEqual([]);
	});
});

describe('tenants', () => {
	it('archives a tenant once their leases ended and keeps them off new leases', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const tenantId = await seedTenant(db, 'a', { firstName: 'Erika', lastName: 'Muster' });
		const other = await seedTenant(db, 'a', { firstName: 'Max', lastName: 'Muster' });
		const leaseId = await seedLease(db, 'a', unitId, {
			tenantIds: [tenantId],
			endDate: '2025-06-30'
		});

		expect((await tenantArchiving(db, 'a', tenantId, '2025-06-01'))?.runningLeases).toHaveLength(1);
		expect(await archiveTenant(db, contextA, tenantId, '2025-06-01')).toBe('in-use');
		expect(await archiveTenant(db, contextA, tenantId, '2025-07-01')).toBe('archived');
		expect((await listTenants(db, 'a')).map((row) => row.id)).toEqual([other]);
		expect(await listTenants(db, 'a', { archived: true })).toHaveLength(2);

		expect(
			await createLease(
				db,
				contextA,
				leaseInput(unitId, { startDate: '2025-07-01', tenantIds: [tenantId] })
			)
		).toEqual({ ok: false, reason: 'archived' });

		// The ended lease keeps the archived tenant on an edit, but cannot take on another one.
		const lease = leaseInputOf((await getLease(db, 'a', leaseId))!);
		expect(await updateLease(db, contextA, leaseId, { ...lease, persons: 1 })).toEqual({
			ok: true
		});
		expect(await archiveTenant(db, contextA, other, '2025-07-01')).toBe('archived');
		expect(
			await updateLease(db, contextA, leaseId, { ...lease, tenantIds: [tenantId, other] })
		).toEqual({ ok: false, reason: 'archived' });

		expect(await restoreTenant(db, contextA, tenantId)).toBe(true);
		expect((await listTenants(db, 'a')).map((row) => row.id)).toEqual([tenantId]);
		expect(await restoreTenant(db, contextB, tenantId)).toBe(false);
		expect(await integrityProblems(db)).toEqual([]);
	});
});
