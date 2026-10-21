import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PropertyInput, UnitInput } from '../validation';
import type { Database } from './db';
import { auditLog, units } from './db/schema';
import {
	addProperty,
	addUnit,
	deleteProperty,
	deleteUnit,
	getProperty,
	getUnit,
	listProperties,
	listUnitLeases,
	listUnits,
	propertyOverview,
	unitsWithOccupancy,
	updateProperty,
	updateUnit
} from './properties';
import { address, contextA, contextB, seedLease, seedTenant, testDatabase } from './testing';

function propertyInput(overrides: Partial<PropertyInput> = {}): PropertyInput {
	return {
		name: 'Haus',
		...address,
		buildingUse: 'residential',
		vacancyPersons: 1,
		notes: null,
		...overrides
	};
}

function unitInput(overrides: Partial<UnitInput> = {}): UnitInput {
	return {
		name: 'EG links',
		kind: 'apartment',
		floorArea: 64,
		floor: null,
		rooms: null,
		notes: null,
		...overrides
	};
}

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

async function auditSummaries(accountId: string): Promise<string[]> {
	const rows = await db
		.select({ summary: auditLog.summary })
		.from(auditLog)
		.where(eq(auditLog.accountId, accountId));
	return rows.map((row) => row.summary);
}

describe('properties', () => {
	it('lists only the properties of the given account, sorted by name', async () => {
		await addProperty(db, contextA, propertyInput({ name: 'Zweites Haus' }));
		await addProperty(db, contextA, propertyInput({ name: 'Erstes Haus' }));
		await addProperty(db, contextB, propertyInput({ name: 'Fremdes Haus' }));

		const names = (await listProperties(db, 'a')).map((property) => property.name);
		expect(names).toEqual(['Erstes Haus', 'Zweites Haus']);
	});

	it('does not return a property of another account', async () => {
		const { id } = await addProperty(db, contextB, propertyInput({ name: 'Fremdes Haus' }));
		expect(await getProperty(db, 'a', id)).toBeUndefined();
		expect(await getProperty(db, 'b', id)).toMatchObject({ name: 'Fremdes Haus' });
	});

	it('creates a property with every field and an audit line', async () => {
		const { id } = await addProperty(
			db,
			contextA,
			propertyInput({
				name: 'Gewerbehof',
				buildingUse: 'non_residential',
				vacancyPersons: 0,
				notes: 'Hinterhof'
			})
		);
		expect(await getProperty(db, 'a', id)).toMatchObject({
			accountId: 'a',
			name: 'Gewerbehof',
			buildingUse: 'non_residential',
			vacancyPersons: 0,
			notes: 'Hinterhof'
		});
		const [entry] = await db.select().from(auditLog);
		expect(entry).toMatchObject({
			accountId: 'a',
			userId: 'user-a',
			entity: 'property',
			entityId: id,
			action: 'create',
			summary: 'Objekt Gewerbehof angelegt'
		});
	});

	it('updates every field and refuses a property of another account', async () => {
		const { id } = await addProperty(db, contextA, propertyInput());
		const changed = propertyInput({
			name: 'Haus Neu',
			street: 'Neue Straße 1',
			postalCode: '20095',
			city: 'Hamburg',
			buildingUse: 'non_residential',
			vacancyPersons: 2,
			notes: 'geändert'
		});
		expect(await updateProperty(db, contextA, id, changed)).toBe(true);
		expect(await getProperty(db, 'a', id)).toMatchObject(changed);

		expect(await updateProperty(db, contextB, id, propertyInput({ name: 'Gekapert' }))).toBe(false);
		expect((await getProperty(db, 'a', id))?.name).toBe('Haus Neu');
		expect(await auditSummaries('a')).toEqual(['Objekt Haus angelegt', 'Objekt Haus Neu geändert']);
		expect(await auditSummaries('b')).toEqual([]);
	});

	it('deletes a property with its units', async () => {
		const { id } = await addProperty(db, contextA, propertyInput());
		await addUnit(db, contextA, id, unitInput());

		expect(await deleteProperty(db, contextA, id)).toBe('deleted');
		expect(await getProperty(db, 'a', id)).toBeUndefined();
		expect(await db.select().from(units).where(eq(units.propertyId, id))).toEqual([]);
		expect(await auditSummaries('a')).toContain('Objekt Haus gelöscht');
	});

	it('refuses to delete a property whose unit has a lease, even an ended one', async () => {
		const { id } = await addProperty(db, contextA, propertyInput());
		const unit = await addUnit(db, contextA, id, unitInput());
		await seedLease(db, 'a', unit!.id, { startDate: '2024-01-01', endDate: '2024-12-31' });

		expect(await deleteProperty(db, contextA, id)).toBe('in-use');
		expect(await getProperty(db, 'a', id)).toBeDefined();
		expect(await auditSummaries('a')).not.toContain('Objekt Haus gelöscht');
	});

	it('does not delete a property of another account', async () => {
		const { id } = await addProperty(db, contextB, propertyInput({ name: 'Fremdes Haus' }));
		expect(await deleteProperty(db, contextA, id)).toBe('missing');
		expect(await getProperty(db, 'b', id)).toBeDefined();
	});
});

describe('units', () => {
	it('creates units within a property of the same account', async () => {
		const { id } = await addProperty(db, contextA, propertyInput());
		await addUnit(db, contextA, id, unitInput({ name: 'OG', floorArea: 64 }));
		await addUnit(db, contextA, id, unitInput({ name: 'EG', kind: 'commercial', floorArea: null }));

		const rows = await listUnits(db, 'a', id);
		expect(rows.map((unit) => [unit.name, unit.kind, unit.floorArea])).toEqual([
			['EG', 'commercial', null],
			['OG', 'apartment', 64]
		]);
	});

	it('refuses to add a unit to a property of another account', async () => {
		const { id } = await addProperty(db, contextB, propertyInput({ name: 'Fremdes Haus' }));
		expect(await addUnit(db, contextA, id, unitInput())).toBeUndefined();
		expect(await listUnits(db, 'b', id)).toEqual([]);
		expect(await auditSummaries('a')).toEqual([]);
	});

	it('creates, reads and updates a unit with floor, rooms and notes, with audit lines', async () => {
		const { id: propertyId } = await addProperty(db, contextA, propertyInput());
		const created = await addUnit(
			db,
			contextA,
			propertyId,
			unitInput({ name: 'DG', floor: 'DG', rooms: 2.5, notes: 'Dachschräge' })
		);
		expect(await getUnit(db, 'a', created!.id)).toMatchObject({
			propertyId,
			name: 'DG',
			floor: 'DG',
			rooms: 2.5,
			notes: 'Dachschräge'
		});

		const changed = unitInput({
			name: 'DG rechts',
			kind: 'commercial',
			floorArea: 48.5,
			floor: '3. OG',
			rooms: 3,
			notes: null
		});
		expect(await updateUnit(db, contextA, created!.id, changed)).toBe(true);
		expect(await getUnit(db, 'a', created!.id)).toMatchObject({ ...changed, propertyId });
		expect(await auditSummaries('a')).toEqual([
			'Objekt Haus angelegt',
			'Einheit DG in Haus angelegt',
			'Einheit DG rechts in Haus geändert'
		]);
	});

	it('does not read or update a unit of another account', async () => {
		const { id: propertyId } = await addProperty(db, contextB, propertyInput());
		const unit = await addUnit(db, contextB, propertyId, unitInput());
		expect(await getUnit(db, 'a', unit!.id)).toBeUndefined();
		expect(await updateUnit(db, contextA, unit!.id, unitInput({ name: 'Gekapert' }))).toBe(false);
		expect(await deleteUnit(db, contextA, unit!.id)).toBe('missing');
		expect((await getUnit(db, 'b', unit!.id))?.name).toBe('EG links');
	});

	it('deletes a unit without a lease and refuses one with a lease', async () => {
		const { id: propertyId } = await addProperty(db, contextA, propertyInput());
		const free = await addUnit(db, contextA, propertyId, unitInput({ name: 'Frei' }));
		const rented = await addUnit(db, contextA, propertyId, unitInput({ name: 'Vermietet' }));
		await seedLease(db, 'a', rented!.id, { endDate: '2025-06-30' });

		expect(await deleteUnit(db, contextA, free!.id)).toBe('deleted');
		expect(await getUnit(db, 'a', free!.id)).toBeUndefined();
		// An ended lease still references the unit; its history must stay.
		expect(await deleteUnit(db, contextA, rented!.id)).toBe('in-use');
		expect(await getUnit(db, 'a', rented!.id)).toBeDefined();
		expect(await auditSummaries('a')).toContain('Einheit Frei in Haus gelöscht');
	});
});

describe('unitsWithOccupancy', () => {
	it('names the leases running on the date with their tenants', async () => {
		const { id: propertyId } = await addProperty(db, contextA, propertyInput());
		const flat = await addUnit(db, contextA, propertyId, unitInput({ name: 'EG' }));
		const vacant = await addUnit(db, contextA, propertyId, unitInput({ name: 'OG' }));
		const erika = await seedTenant(db, 'a');
		const max = await seedTenant(db, 'a', { firstName: 'Max', lastName: 'Beispiel' });
		// Lease A ended, lease B runs.
		await seedLease(db, 'a', flat!.id, {
			startDate: '2024-01-01',
			endDate: '2024-12-31',
			tenantIds: [max]
		});
		const leaseId = await seedLease(db, 'a', flat!.id, { tenantIds: [erika, max] });

		const rows = await unitsWithOccupancy(db, 'a', propertyId, '2025-06-15');
		expect(rows.map((unit) => unit.name)).toEqual(['EG', 'OG']);
		const [eg, og] = rows;
		expect(eg.occupancies).toHaveLength(1);
		expect(eg.occupancies[0]).toMatchObject({ leaseId, startDate: '2025-01-01', endDate: null });
		expect(eg.occupancies[0].tenants.map((tenant) => tenant.lastName)).toEqual([
			'Beispiel',
			'Mustermann'
		]);
		expect(og.occupancies).toEqual([]);
		expect(vacant!.id).toBe(og.id);

		// Before the current lease started, the ended lease occupied the flat.
		const earlier = await unitsWithOccupancy(db, 'a', propertyId, '2024-06-15');
		expect(earlier[0].occupancies[0].tenants.map((tenant) => tenant.lastName)).toEqual([
			'Beispiel'
		]);
	});

	it('does not leak units or leases of another account', async () => {
		const { id: propertyId } = await addProperty(db, contextB, propertyInput());
		const unit = await addUnit(db, contextB, propertyId, unitInput());
		await seedLease(db, 'b', unit!.id);
		expect(await unitsWithOccupancy(db, 'a', propertyId, '2025-06-15')).toEqual([]);
		const own = await unitsWithOccupancy(db, 'b', propertyId, '2025-06-15');
		expect(own[0].occupancies).toHaveLength(1);
	});
});

describe('listUnitLeases', () => {
	it('lists running, upcoming and ended leases of a unit or a property, newest first', async () => {
		const { id: propertyId } = await addProperty(db, contextA, propertyInput());
		const eg = await addUnit(db, contextA, propertyId, unitInput({ name: 'EG' }));
		const og = await addUnit(db, contextA, propertyId, unitInput({ name: 'OG' }));
		const erika = await seedTenant(db, 'a');
		const ended = await seedLease(db, 'a', eg!.id, {
			startDate: '2024-01-01',
			endDate: '2024-12-31'
		});
		const running = await seedLease(db, 'a', eg!.id, { tenantIds: [erika] });
		const upcoming = await seedLease(db, 'a', og!.id, { startDate: '2026-01-01' });
		// Another property's lease is not listed.
		const { id: otherId } = await addProperty(db, contextA, propertyInput({ name: 'Anderes' }));
		const other = await addUnit(db, contextA, otherId, unitInput());
		await seedLease(db, 'a', other!.id);

		const onUnit = await listUnitLeases(db, 'a', { unitId: eg!.id }, '2025-06-15');
		expect(onUnit.map((lease) => [lease.id, lease.active, lease.upcoming])).toEqual([
			[running, true, false],
			[ended, false, false]
		]);
		expect(onUnit[0]).toMatchObject({ unitId: eg!.id, unitName: 'EG', endDate: null });
		expect(onUnit[0].tenants.map((tenant) => tenant.firstName)).toEqual(['Erika']);
		expect(onUnit[1].tenants).toEqual([]);

		const onProperty = await listUnitLeases(db, 'a', { propertyId }, '2025-06-15');
		expect(onProperty.map((lease) => [lease.unitName, lease.upcoming])).toEqual([
			['OG', true],
			['EG', false],
			['EG', false]
		]);
		expect(onProperty[0].id).toBe(upcoming);
	});

	it('does not list leases of another account', async () => {
		const { id: propertyId } = await addProperty(db, contextB, propertyInput());
		const unit = await addUnit(db, contextB, propertyId, unitInput());
		await seedLease(db, 'b', unit!.id);
		expect(await listUnitLeases(db, 'a', { propertyId }, '2025-06-15')).toEqual([]);
		expect(await listUnitLeases(db, 'a', { unitId: unit!.id }, '2025-06-15')).toEqual([]);
	});
});

describe('propertyOverview', () => {
	it('counts units, running leases and vacant units per property', async () => {
		const { id: houseId } = await addProperty(db, contextA, propertyInput({ name: 'Haus' }));
		const eg = await addUnit(db, contextA, houseId, unitInput({ name: 'EG' }));
		const og = await addUnit(db, contextA, houseId, unitInput({ name: 'OG' }));
		await addUnit(db, contextA, houseId, unitInput({ name: 'DG' }));
		const { id: garageId } = await addProperty(db, contextA, propertyInput({ name: 'Garagen' }));
		await addUnit(
			db,
			contextA,
			garageId,
			unitInput({ name: 'Stellplatz 1', kind: 'parking', floorArea: null })
		);
		await addProperty(db, contextA, propertyInput({ name: 'Leer' }));
		// EG runs; OG ended last year; DG never rented.
		await seedLease(db, 'a', eg!.id);
		await seedLease(db, 'a', og!.id, { startDate: '2024-01-01', endDate: '2024-12-31' });
		// Another account's data must not count.
		const { id: foreignId } = await addProperty(db, contextB, propertyInput({ name: 'Fremd' }));
		const foreignUnit = await addUnit(db, contextB, foreignId, unitInput());
		await seedLease(db, 'b', foreignUnit!.id);

		const overview = await propertyOverview(db, 'a', '2025-06-15');
		expect(
			overview.map((row) => [row.name, row.unitCount, row.activeLeases, row.vacantUnits])
		).toEqual([
			['Garagen', 1, 0, 1],
			// Haus: 3 units, one running lease (EG), OG's lease ended, so OG and DG are vacant.
			['Haus', 3, 1, 2],
			['Leer', 0, 0, 0]
		]);
	});
});
