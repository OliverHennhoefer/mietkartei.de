import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { getMeter, listMeters, listReadings } from '#lib/server/operating-costs.ts';
import { outcome, routeEvent, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

let db: Database;
let propertyId: string;
let unitId: string;

beforeEach(async () => {
	db = await testDatabase();
	({ propertyId, unitId } = await seedUnit(db, 'a'));
});

const meter = { kind: 'heat', unit: 'kWh', serialNumber: 'W-1', installedAt: '2024-01-01' };

function act(action: keyof typeof actions, form: Record<string, string>, id = propertyId) {
	return outcome(() => actions[action](routeEvent(db, { params: { id }, form })));
}

function page(query = '') {
	return outcome(() =>
		load(
			routeEvent(db, {
				url: `/objekte/${propertyId}/zaehler${query}`,
				parent: { property: { id: propertyId } }
			})
		)
	);
}

/** Creates a meter of the unit and returns its id. */
async function createMeter(): Promise<string> {
	await act('createMeter', { ...meter, unitId });
	return (await listMeters(db, 'a', propertyId))[0].id;
}

describe('zaehler', () => {
	it('creates a meter and opens it, keeping the unit filter', async () => {
		const result = await act('createMeter', { ...meter, unitId, filterUnit: unitId });
		const [created] = await listMeters(db, 'a', propertyId);
		expect(result).toEqual({
			redirect: `/objekte/${propertyId}/zaehler?unit=${unitId}&meter=${created.id}`
		});
	});

	it('refuses a meter on a foreign unit or property', async () => {
		const other = await seedUnit(db, 'b');
		expect(await act('createMeter', { ...meter, unitId: other.unitId })).toMatchObject({
			fail: 400,
			data: { form: 'meter', errors: { unitId: expect.any(String) } }
		});
		expect(await act('createMeter', meter, other.propertyId)).toMatchObject({ error: 404 });
		expect(await act('createMeter', { ...meter, kind: 'wind' })).toMatchObject({ fail: 400 });
	});

	it('filters by unit and shows the readings of the expanded meter', async () => {
		const meterId = await createMeter();
		await act('createMeter', { ...meter, serialNumber: 'Haus' });
		await act('createReading', { meterId, readAt: '2025-01-01', value: '100' });
		expect(await page()).toMatchObject({
			data: { meters: [{}, {}], expanded: null, readings: [] }
		});
		expect(await page(`?unit=${unitId}&meter=${meterId}`)).toMatchObject({
			data: {
				meters: [{ id: meterId }],
				filterUnit: { id: unitId },
				expanded: { id: meterId },
				readings: [{ value: 100 }]
			}
		});
		expect(await page('?unit=fremd&meter=fremd')).toMatchObject({
			data: { filterUnit: null, expanded: null }
		});
	});

	it('adds readings once per day and deletes them', async () => {
		const meterId = await createMeter();
		const reading = { meterId, readAt: '2025-01-01', value: '100' };
		expect(await act('createReading', reading)).toEqual({
			redirect: `/objekte/${propertyId}/zaehler?meter=${meterId}`
		});
		expect(await act('createReading', reading)).toMatchObject({
			fail: 400,
			data: { form: 'reading', errors: { readAt: expect.any(String) } }
		});
		expect(await act('createReading', { ...reading, value: '-1' })).toMatchObject({ fail: 400 });
		const [{ id: readingId }] = await listReadings(db, 'a', meterId);
		expect(await act('deleteReading', { meterId, readingId: 'fremd' })).toMatchObject({
			error: 404
		});
		expect(await act('deleteReading', { meterId, readingId })).toEqual({
			redirect: `/objekte/${propertyId}/zaehler?meter=${meterId}`
		});
		expect(await listReadings(db, 'a', meterId)).toEqual([]);
	});

	it('removes a meter from service, not before it was installed, and deletes it', async () => {
		const meterId = await createMeter();
		expect(await act('removeMeter', { meterId, removedAt: '2023-12-31' })).toMatchObject({
			fail: 400,
			data: { form: 'removal', errors: { removedAt: 'Der Ausbau liegt vor dem Einbau.' } }
		});
		expect(await act('removeMeter', { meterId, removedAt: '' })).toMatchObject({ fail: 400 });
		expect(await act('removeMeter', { meterId, removedAt: '2025-06-30' })).toEqual({
			redirect: `/objekte/${propertyId}/zaehler`
		});
		expect((await getMeter(db, 'a', meterId))?.removedAt).toBe('2025-06-30');
		expect(await act('deleteMeter', { meterId })).toEqual({
			redirect: `/objekte/${propertyId}/zaehler`
		});
		expect(await getMeter(db, 'a', meterId)).toBeUndefined();
	});

	it('answers 404 for a meter of another property', async () => {
		const meterId = await createMeter();
		const second = await seedUnit(db, 'a', { propertyName: 'Zweites' });
		for (const action of [
			'createReading',
			'removeMeter',
			'deleteMeter',
			'deleteReading'
		] as const) {
			expect(await act(action, { meterId }, second.propertyId), action).toMatchObject({
				error: 404
			});
		}
		expect(await act('deleteMeter', {})).toMatchObject({ error: 404 });
	});
});
