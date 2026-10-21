import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db';
import { auditLog, meterReadings, meters, units } from '../db/schema';
import { QUOTAS } from '../quotas';
import { contextA, contextB, seedUnit, testDatabase } from '../testing';
import {
	createMeter,
	createReading,
	deleteMeter,
	deleteReading,
	getMeter,
	listMeters,
	listReadings,
	meterLabel,
	removeMeter,
	type MeterInput
} from './meters';

let db: Database;
let propertyId: string;
let unitId: string;

beforeEach(async () => {
	db = await testDatabase();
	({ propertyId, unitId } = await seedUnit(db, 'a', { name: 'EG' }));
});

function input(overrides: Partial<MeterInput> = {}): MeterInput {
	return {
		unitId,
		kind: 'heat',
		serialNumber: 'WMZ-001',
		unit: 'kWh',
		location: 'Flur',
		installedAt: '2024-01-01',
		...overrides
	};
}

async function create(
	context: typeof contextA,
	property: string,
	overrides: Partial<MeterInput> = {}
) {
	const result = await createMeter(db, context, property, input(overrides));
	if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
	return result.id;
}

async function read(meterId: string, readAt: string, value: number, estimated = false) {
	const result = await createReading(db, contextA, meterId, {
		readAt,
		value,
		estimated,
		note: null
	});
	if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
	return result.id;
}

describe('meters', () => {
	it('refuses a meter or a reading above the account limit with 409', async () => {
		const meterId = await create(contextA, propertyId);
		await read(meterId, '2025-01-01', 1);
		const limits = { meters: QUOTAS.meters.max, meterReadings: QUOTAS.meterReadings.max };
		QUOTAS.meters.max = 1;
		QUOTAS.meterReadings.max = 1;
		try {
			const meter = await createMeter(db, contextA, propertyId, input()).catch((e) => e);
			expect(isHttpError(meter, 409)).toBe(true);
			expect(meter.body.message).toContain('höchstens 1 Zähler');
			const reading = await createReading(db, contextA, meterId, {
				readAt: '2025-06-01',
				value: 2,
				estimated: false,
				note: null
			}).catch((e) => e);
			expect(isHttpError(reading, 409)).toBe(true);
			expect(reading.body.message).toContain('höchstens 1 Zählerstände');
			// Another account's rows do not count.
			const other = await seedUnit(db, 'b', { name: 'OG' });
			await expect(
				createMeter(db, contextB, other.propertyId, input({ unitId: other.unitId }))
			).resolves.toMatchObject({ ok: true });
		} finally {
			QUOTAS.meters.max = limits.meters;
			QUOTAS.meterReadings.max = limits.meterReadings;
		}
		expect(await db.select().from(meters)).toHaveLength(2);
		expect(await db.select().from(meterReadings)).toHaveLength(1);
	});

	it('creates a meter of a unit and logs it with its label', async () => {
		const id = await create(contextA, propertyId);
		expect(await getMeter(db, 'a', id)).toMatchObject({
			accountId: 'a',
			propertyId,
			unitId,
			unitName: 'EG',
			kind: 'heat',
			serialNumber: 'WMZ-001',
			unit: 'kWh',
			location: 'Flur',
			installedAt: '2024-01-01',
			removedAt: null
		});
		expect(meterLabel({ kind: 'heat', serialNumber: 'WMZ-001' })).toBe('Wärme WMZ-001');
		expect(meterLabel({ kind: 'cold_water', serialNumber: null })).toBe('Kaltwasser');
		const audit = await db.select().from(auditLog).where(eq(auditLog.entity, 'meter'));
		expect(audit.map((entry) => entry.summary)).toEqual(['Zähler Wärme WMZ-001 angelegt']);
	});

	it('refuses an unknown property and a unit of another property', async () => {
		const other = await seedUnit(db, 'a', { propertyName: 'Anderes Haus' });
		expect(await createMeter(db, contextA, 'nope', input())).toEqual({
			ok: false,
			reason: 'unknown-property'
		});
		expect(await createMeter(db, contextA, propertyId, input({ unitId: other.unitId }))).toEqual({
			ok: false,
			reason: 'unknown-unit'
		});
	});

	it('lists building meters first, then by unit name, each with its latest reading', async () => {
		const [og] = await db
			.insert(units)
			.values({ accountId: 'a', propertyId, name: 'OG', kind: 'apartment' })
			.returning({ id: units.id });
		const ogMeter = await create(contextA, propertyId, { unitId: og.id, serialNumber: 'OG-1' });
		const egMeter = await create(contextA, propertyId, { serialNumber: 'EG-1' });
		const building = await create(contextA, propertyId, {
			unitId: null,
			kind: 'gas',
			serialNumber: 'GAS-1'
		});
		await read(egMeter, '2025-01-01', 1000);
		await read(egMeter, '2025-12-31', 2200, true);
		await read(egMeter, '2025-06-30', 1600);
		await read(building, '2025-12-31', 25000);

		const meters = await listMeters(db, 'a', propertyId);
		expect(
			meters.map((meter) => [meter.serialNumber, meter.unitName, meter.lastReading?.readAt])
		).toEqual([
			['GAS-1', null, '2025-12-31'],
			['EG-1', 'EG', '2025-12-31'],
			['OG-1', 'OG', undefined]
		]);
		expect(meters[1].lastReading).toMatchObject({ value: 2200, estimated: true });
		expect(meters.find((meter) => meter.id === ogMeter)!.lastReading).toBeNull();
	});

	it('closes and deletes a meter with its readings', async () => {
		const id = await create(contextA, propertyId);
		expect(await removeMeter(db, contextA, id, '2023-12-31')).toBe('before-installation');
		expect((await getMeter(db, 'a', id))!.removedAt).toBeNull();
		expect(await removeMeter(db, contextA, id, '2025-12-31')).toBe('updated');
		expect((await getMeter(db, 'a', id))!.removedAt).toBe('2025-12-31');

		await read(id, '2025-01-01', 1000);
		await read(id, '2025-12-31', 2200);
		expect(await deleteMeter(db, contextA, id)).toBe('deleted');
		expect(await getMeter(db, 'a', id)).toBeUndefined();
		expect(await db.select().from(meterReadings)).toEqual([]);
		const audit = await db.select().from(auditLog).where(eq(auditLog.entity, 'meter'));
		expect(audit.map((entry) => entry.summary)).toEqual([
			'Zähler Wärme WMZ-001 angelegt',
			'Zähler Wärme WMZ-001 am 31.12.2025 ausgebaut',
			'Zähler Wärme WMZ-001 mit 2 Zählerständen gelöscht'
		]);
	});

	it('keeps one reading per date, newest first, and logs the value', async () => {
		const id = await create(contextA, propertyId);
		const first = await read(id, '2025-01-01', 1000.5);
		await read(id, '2025-12-31', 2200, true);
		expect(
			await createReading(db, contextA, id, {
				readAt: '2025-01-01',
				value: 1,
				estimated: false,
				note: null
			})
		).toEqual({
			ok: false,
			reason: 'duplicate-date'
		});
		expect(
			(await listReadings(db, 'a', id)).map((row) => [row.readAt, row.value, row.estimated])
		).toEqual([
			['2025-12-31', 2200, true],
			['2025-01-01', 1000.5, false]
		]);
		const other = await create(contextA, propertyId, { serialNumber: 'WMZ-002' });
		expect(await deleteReading(db, contextA, other, first)).toBe('missing');
		expect(await deleteReading(db, contextA, id, first)).toBe('deleted');
		expect(await listReadings(db, 'a', id)).toHaveLength(1);
		const audit = await db.select().from(auditLog).where(eq(auditLog.entity, 'meter_reading'));
		expect(audit.map((entry) => entry.summary)).toEqual([
			'Zählerstand 1.000,5 kWh am 01.01.2025 für Zähler Wärme WMZ-001 erfasst',
			'Zählerstand 2.200 kWh am 31.12.2025 für Zähler Wärme WMZ-001 erfasst (geschätzt)',
			'Zählerstand vom 01.01.2025 für Zähler Wärme WMZ-001 gelöscht'
		]);
	});

	it('does not leak into another account', async () => {
		const foreignPlace = await seedUnit(db, 'b');
		const foreign = await create(contextB, foreignPlace.propertyId, {
			unitId: foreignPlace.unitId
		});
		const foreignReading = await createReading(db, contextB, foreign, {
			readAt: '2025-01-01',
			value: 1,
			estimated: false,
			note: null
		});
		if (!foreignReading.ok) throw new Error('setup failed');

		expect(await listMeters(db, 'a', foreignPlace.propertyId)).toEqual([]);
		expect(await getMeter(db, 'a', foreign)).toBeUndefined();
		expect(await listReadings(db, 'a', foreign)).toEqual([]);
		expect(await removeMeter(db, contextA, foreign, '2025-12-31')).toBe('missing');
		expect(await deleteMeter(db, contextA, foreign)).toBe('missing');
		expect(
			await createReading(db, contextA, foreign, {
				readAt: '2025-02-01',
				value: 2,
				estimated: false,
				note: null
			})
		).toEqual({ ok: false, reason: 'missing' });
		expect(await deleteReading(db, contextA, foreign, foreignReading.id)).toBe('missing');
		expect(
			await createMeter(db, contextA, foreignPlace.propertyId, input({ unitId: null }))
		).toEqual({ ok: false, reason: 'unknown-property' });
		expect(await listReadings(db, 'b', foreign)).toHaveLength(1);
	});
});
