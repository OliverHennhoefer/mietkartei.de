import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { units } from '#lib/server/db/schema.ts';
import { ensureDefaults, getCostItem, getKey, listKeys } from '#lib/server/operating-costs.ts';
import { outcome, routeEvent, seedCostItem, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { actions as keyActions, load as loadKey } from './[id]/+page.server';
import { actions, load } from './+page.server';

let db: Database;
let propertyId: string;
let unitIds: string[];

beforeEach(async () => {
	db = await testDatabase();
	const seeded = await seedUnit(db, 'a');
	propertyId = seeded.propertyId;
	const [second] = await db
		.insert(units)
		.values({ accountId: 'a', propertyId, name: 'OG', kind: 'apartment', floorArea: 50 })
		.returning({ id: units.id });
	unitIds = [seeded.unitId, second.id];
});

function create(form: Record<string, string>) {
	return outcome(() => actions.create(routeEvent(db, { form })));
}

/** Creates a custom key of the property and returns its id. */
async function customKey(name = 'Garten') {
	const result = await create({ name, kind: 'custom', propertyId });
	if (!('redirect' in result)) throw new Error(JSON.stringify(result));
	return result.redirect.split('/').at(-1)!;
}

function act(action: keyof typeof keyActions, id: string, form: Record<string, string> = {}) {
	return outcome(() => keyActions[action](routeEvent(db, { params: { id }, form })));
}

describe('schluessel', () => {
	it('lists the standard keys and the properties', async () => {
		expect(await outcome(() => load(routeEvent(db)))).toMatchObject({
			data: { keys: expect.arrayContaining([expect.objectContaining({ name: 'Wohnfläche' })]) }
		});
	});

	it('creates a key and refuses invalid ones', async () => {
		const id = await customKey();
		expect((await getKey(db, 'a', id))?.kind).toBe('custom');
		expect(await create({ name: 'Garten', kind: 'custom', propertyId })).toMatchObject({
			fail: 400,
			data: { errors: { name: expect.stringContaining('gibt es schon') } }
		});
		// A custom key needs a property; a HeizKV key splits 50–70 % by consumption.
		expect(await create({ name: 'Ohne', kind: 'custom' })).toMatchObject({ fail: 400 });
		expect(
			await create({ name: 'Heizung', kind: 'mixed', meterKind: 'heat', consumptionPercent: '90' })
		).toMatchObject({ fail: 400, data: { errors: { consumptionPercent: expect.any(String) } } });
		const other = await seedUnit(db, 'b');
		expect(
			await create({ name: 'Fremd', kind: 'custom', propertyId: other.propertyId })
		).toMatchObject({ fail: 400, data: { errors: { propertyId: expect.any(String) } } });
	});
});

describe('schluessel/[id]', () => {
	it('answers 404 for a key of another account', async () => {
		await ensureDefaults(db, 'b');
		const [foreign] = await listKeys(db, 'b');
		expect(
			await outcome(() => loadKey(routeEvent(db, { params: { id: foreign.id } })))
		).toMatchObject({ error: 404 });
		for (const action of ['update', 'shares', 'delete'] as const) {
			expect(await act(action, foreign.id, { name: 'x', kind: 'area' }), action).toMatchObject({
				error: 404
			});
		}
	});

	it('shows one share input per unit for a custom key and saves the shares', async () => {
		const id = await customKey();
		expect(await outcome(() => loadKey(routeEvent(db, { params: { id } })))).toMatchObject({
			data: { units: [{ id: unitIds[0] }, { id: unitIds[1] }], shares: [] }
		});
		expect(await act('shares', id, { [`share-${unitIds[0]}`]: '-1' })).toMatchObject({
			fail: 400,
			data: { form: 'shares', shareErrors: expect.anything() }
		});
		expect(
			await act('shares', id, { [`share-${unitIds[0]}`]: '3', [`share-${unitIds[1]}`]: '1' })
		).toEqual({ data: { form: 'shares', saved: true } });
		expect(await outcome(() => loadKey(routeEvent(db, { params: { id } })))).toMatchObject({
			data: { shares: [expect.anything(), expect.anything()] }
		});
	});

	it('has no shares for the standard keys', async () => {
		await ensureDefaults(db, 'a');
		const area = (await listKeys(db, 'a')).find((key) => key.kind === 'area')!;
		expect(await outcome(() => loadKey(routeEvent(db, { params: { id: area.id } })))).toMatchObject(
			{ data: { units: [], shares: [] } }
		);
		expect(await act('shares', area.id)).toMatchObject({ fail: 400, data: { form: 'shares' } });
	});

	it('updates a key and refuses changes its cost items do not allow', async () => {
		const id = await customKey();
		expect(await act('update', id, { name: 'Gartenpflege', kind: 'custom', propertyId })).toEqual({
			redirect: `/betriebskosten/schluessel/${id}`
		});
		expect(await act('update', id, { name: '', kind: 'custom' })).toMatchObject({
			fail: 400,
			data: { form: 'key' }
		});
		await seedCostItem(db, 'a', propertyId, { allocationKeyId: id });
		expect(
			await act('update', id, { name: 'Gartenpflege', kind: 'direct', propertyId })
		).toMatchObject({
			fail: 400,
			data: { form: 'key', errors: { kind: expect.any(String) } }
		});
	});

	it('deletes an unused key and keeps one with cost items', async () => {
		const id = await customKey();
		const itemId = await seedCostItem(db, 'a', propertyId);
		const usedKey = (await getCostItem(db, 'a', itemId))!.allocationKeyId;
		expect(await act('delete', usedKey)).toMatchObject({
			fail: 400,
			data: { form: 'delete', refused: expect.stringMatching(/von 1\sBeleg verwendet/) }
		});
		expect(await act('delete', id)).toEqual({ redirect: '/betriebskosten/schluessel' });
		expect(await getKey(db, 'a', id)).toBeUndefined();
	});
});
