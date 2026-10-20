import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import {
	auditLog,
	leasePersons,
	leaseTenants,
	leaseUnits,
	payments,
	rentChanges
} from './db/schema';
import {
	createLease,
	deleteLease,
	getLease,
	isActive,
	leaseLabel,
	listLeases,
	listUnitsWithProperty,
	updateLease
} from './leases';
import { contextA, contextB, leaseInput, seedTenant, seedUnit, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

describe('isActive', () => {
	it('is active from the start date to the end date, inclusive', () => {
		const lease = { startDate: '2025-01-01', endDate: '2025-12-31' };
		expect(isActive(lease, '2024-12-31')).toBe(false);
		expect(isActive(lease, '2025-01-01')).toBe(true);
		expect(isActive(lease, '2025-12-31')).toBe(true);
		expect(isActive(lease, '2026-01-01')).toBe(false);
		expect(isActive({ startDate: '2025-01-01', endDate: null }, '2099-01-01')).toBe(true);
	});
});

describe('createLease', () => {
	it('creates the lease with tenants, extra units, the initial rent and an audit line', async () => {
		const { unitId, propertyId } = await seedUnit(db, 'a', { name: 'EG links' });
		const { unitId: parkingId } = await seedUnit(db, 'a', { name: 'Stellplatz 3' });
		const tenantId = await seedTenant(db, 'a');

		const result = await createLease(
			db,
			contextA,
			leaseInput(unitId, { tenantIds: [tenantId, tenantId], extraUnitIds: [parkingId, unitId] })
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const lease = await getLease(db, 'a', result.id);
		expect(lease).toMatchObject({
			unit: { id: unitId, name: 'EG links' },
			property: { id: propertyId },
			baseRent: 60000,
			currentRent: { baseRent: 60000, operatingCostPrepayment: 15000, heatingCostPrepayment: 5000 },
			active: true
		});
		expect(leaseLabel(lease!)).toBe('EG links · Haus');
		expect(lease!.tenants.map((tenant) => tenant.id)).toEqual([tenantId]);
		// The main unit is never also an extra unit, and duplicates are dropped.
		expect(lease!.extraUnits.map((unit) => unit.id)).toEqual([parkingId]);

		const history = await db.select().from(rentChanges).where(eq(rentChanges.leaseId, result.id));
		expect(history).toHaveLength(1);
		expect(history[0]).toMatchObject({
			accountId: 'a',
			validFrom: '2025-01-01',
			reason: 'initial',
			status: 'approved',
			createdBy: 'user-a'
		});
		const persons = await db.select().from(leasePersons).where(eq(leasePersons.leaseId, result.id));
		expect(persons).toHaveLength(1);
		expect(persons[0]).toMatchObject({ accountId: 'a', validFrom: '2025-01-01', persons: 2 });
		const extra = await db.select().from(leaseUnits);
		expect(extra).toEqual([{ accountId: 'a', leaseId: result.id, unitId: parkingId }]);

		const audit = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(audit.map((entry) => [entry.entity, entry.entityId, entry.action])).toEqual([
			['lease', result.id, 'create']
		]);
	});

	it('refuses units and tenants of another account', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const { unitId: foreignUnit } = await seedUnit(db, 'b');
		const foreignTenant = await seedTenant(db, 'b');

		expect(await createLease(db, contextA, leaseInput(foreignUnit))).toEqual({
			ok: false,
			reason: 'unknown-unit'
		});
		expect(
			await createLease(db, contextA, leaseInput(unitId, { extraUnitIds: [foreignUnit] }))
		).toEqual({ ok: false, reason: 'unknown-unit' });
		expect(
			await createLease(db, contextA, leaseInput(unitId, { tenantIds: [foreignTenant] }))
		).toEqual({ ok: false, reason: 'unknown-tenant' });
		expect(await listLeases(db, 'a')).toEqual([]);
		expect(await db.select().from(auditLog)).toEqual([]);
	});
});

describe('listLeases and getLease', () => {
	it('lists only the leases of the account, newest start first', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const { unitId: foreignUnit } = await seedUnit(db, 'b');
		await createLease(
			db,
			contextA,
			leaseInput(unitId, { startDate: '2020-01-01', endDate: '2022-12-31' })
		);
		await createLease(db, contextA, leaseInput(unitId, { startDate: '2023-01-01' }));
		await createLease(db, contextB, leaseInput(foreignUnit));

		const starts = (await listLeases(db, 'a')).map((lease) => [lease.startDate, lease.active]);
		expect(starts).toEqual([
			['2023-01-01', true],
			['2020-01-01', false]
		]);
	});

	it('filters by unit (including extra units), tenant and property', async () => {
		const { unitId: flat, propertyId } = await seedUnit(db, 'a', { name: 'Wohnung' });
		const { unitId: parking } = await seedUnit(db, 'a', {
			name: 'Stellplatz',
			propertyName: 'Garage'
		});
		const tenantId = await seedTenant(db, 'a');
		const withParking = await createLease(
			db,
			contextA,
			leaseInput(flat, { extraUnitIds: [parking], tenantIds: [tenantId] })
		);
		const parkingOnly = await createLease(db, contextA, leaseInput(parking));
		if (!withParking.ok || !parkingOnly.ok) throw new Error('setup failed');

		const ids = (leases: { id: string }[]) => leases.map((lease) => lease.id).sort();
		expect(ids(await listLeases(db, 'a', { unitId: parking }))).toEqual(
			[withParking.id, parkingOnly.id].sort()
		);
		expect(ids(await listLeases(db, 'a', { unitId: flat }))).toEqual([withParking.id]);
		expect(ids(await listLeases(db, 'a', { tenantId }))).toEqual([withParking.id]);
		expect(ids(await listLeases(db, 'a', { propertyId }))).toEqual([withParking.id]);
	});

	it('does not return a lease of another account', async () => {
		const { unitId: foreignUnit } = await seedUnit(db, 'b');
		const result = await createLease(db, contextB, leaseInput(foreignUnit));
		if (!result.ok) throw new Error('setup failed');
		expect(await getLease(db, 'a', result.id)).toBeUndefined();
		expect(await getLease(db, 'b', result.id)).toBeDefined();
	});

	it('reports the rent valid today as the current rent', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const result = await createLease(db, contextA, leaseInput(unitId, { startDate: '2020-01-01' }));
		if (!result.ok) throw new Error('setup failed');
		await db.insert(rentChanges).values({
			accountId: 'a',
			leaseId: result.id,
			validFrom: '2021-01-01',
			baseRent: 65000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			reason: 'manual',
			status: 'approved'
		});
		await db.insert(rentChanges).values({
			accountId: 'a',
			leaseId: result.id,
			validFrom: '2099-01-01',
			baseRent: 99000,
			reason: 'manual',
			status: 'approved'
		});
		expect((await getLease(db, 'a', result.id))!.currentRent.baseRent).toBe(65000);
	});
});

describe('updateLease', () => {
	it('replaces tenants and extra units and moves the initial rent with the start date', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const { unitId: parking } = await seedUnit(db, 'a', { name: 'Stellplatz' });
		const first = await seedTenant(db, 'a', { firstName: 'Eins' });
		const second = await seedTenant(db, 'a', { firstName: 'Zwei' });
		const result = await createLease(
			db,
			contextA,
			leaseInput(unitId, { tenantIds: [first], extraUnitIds: [parking] })
		);
		if (!result.ok) throw new Error('setup failed');
		await db.insert(rentChanges).values({
			accountId: 'a',
			leaseId: result.id,
			validFrom: '2026-01-01',
			baseRent: 65000,
			reason: 'manual'
		});

		const updated = await updateLease(
			db,
			contextA,
			result.id,
			leaseInput(unitId, {
				tenantIds: [second],
				extraUnitIds: [],
				startDate: '2025-02-01',
				baseRent: 61000,
				persons: 3
			})
		);
		expect(updated).toEqual({ ok: true });

		const lease = await getLease(db, 'a', result.id);
		expect(lease).toMatchObject({ startDate: '2025-02-01', baseRent: 61000, persons: 3 });
		expect(lease!.tenants.map((tenant) => tenant.firstName)).toEqual(['Zwei']);
		expect(lease!.extraUnits).toEqual([]);
		const persons = await db.select().from(leasePersons).where(eq(leasePersons.leaseId, result.id));
		expect(persons.map((row) => [row.validFrom, row.persons])).toEqual([['2025-02-01', 3]]);

		const history = await db
			.select({ validFrom: rentChanges.validFrom, baseRent: rentChanges.baseRent })
			.from(rentChanges)
			.where(eq(rentChanges.leaseId, result.id))
			.orderBy(rentChanges.validFrom);
		expect(history).toEqual([
			{ validFrom: '2025-02-01', baseRent: 61000 },
			{ validFrom: '2026-01-01', baseRent: 65000 }
		]);
	});

	it('refuses to update a lease of another account or with foreign references', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const { unitId: foreignUnit } = await seedUnit(db, 'b');
		const own = await createLease(db, contextA, leaseInput(unitId));
		const foreign = await createLease(db, contextB, leaseInput(foreignUnit));
		if (!own.ok || !foreign.ok) throw new Error('setup failed');

		expect(await updateLease(db, contextA, foreign.id, leaseInput(unitId))).toEqual({
			ok: false,
			reason: 'missing'
		});
		expect(await updateLease(db, contextA, own.id, leaseInput(foreignUnit))).toEqual({
			ok: false,
			reason: 'unknown-unit'
		});
		expect((await getLease(db, 'a', own.id))!.unitId).toBe(unitId);
	});
});

describe('deleteLease', () => {
	it('deletes the lease with its links and rent history, and logs it', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const { unitId: parking } = await seedUnit(db, 'a', { name: 'Stellplatz' });
		const tenantId = await seedTenant(db, 'a');
		const result = await createLease(
			db,
			contextA,
			leaseInput(unitId, { tenantIds: [tenantId], extraUnitIds: [parking] })
		);
		if (!result.ok) throw new Error('setup failed');

		expect(await deleteLease(db, contextA, result.id)).toBe('deleted');
		expect(await getLease(db, 'a', result.id)).toBeUndefined();
		expect(await db.select().from(leaseTenants)).toEqual([]);
		expect(await db.select().from(leaseUnits)).toEqual([]);
		expect(await db.select().from(leasePersons)).toEqual([]);
		expect(await db.select().from(rentChanges)).toEqual([]);
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'delete'));
		expect(audit[0]?.summary).toBe('Mietvertrag EG links · Haus gelöscht');
	});

	it('does not delete a lease of another account', async () => {
		const { unitId: foreignUnit } = await seedUnit(db, 'b');
		const foreign = await createLease(db, contextB, leaseInput(foreignUnit));
		if (!foreign.ok) throw new Error('setup failed');
		expect(await deleteLease(db, contextA, foreign.id)).toBe('missing');
		expect(await getLease(db, 'b', foreign.id)).toBeDefined();
	});

	it('refuses to delete a lease with payments on it', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const result = await createLease(db, contextA, leaseInput(unitId));
		if (!result.ok) throw new Error('setup failed');
		await db
			.insert(payments)
			.values({ accountId: 'a', leaseId: result.id, date: '2025-02-03', amount: 80000 });
		expect(await deleteLease(db, contextA, result.id)).toBe('in-use');
		expect(await getLease(db, 'a', result.id)).toBeDefined();
	});
});

describe('listUnitsWithProperty', () => {
	it('lists the units of the account with their property, sorted by property then unit', async () => {
		await seedUnit(db, 'a', { name: 'OG', propertyName: 'Haus B' });
		await seedUnit(db, 'a', { name: 'EG', propertyName: 'Haus A' });
		await seedUnit(db, 'b', { name: 'Fremd', propertyName: 'Haus 0' });
		const rows = await listUnitsWithProperty(db, 'a');
		expect(rows.map((row) => [row.property.name, row.unit.name])).toEqual([
			['Haus A', 'EG'],
			['Haus B', 'OG']
		]);
	});
});
