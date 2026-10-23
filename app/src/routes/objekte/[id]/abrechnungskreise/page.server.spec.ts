import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { getCircle, listCircles } from '#lib/server/operating-costs.ts';
import { outcome, routeEvent, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { actions as circleActions, load as loadCircle } from './[circleId]/+page.server';
import { actions, load } from './+page.server';

let db: Database;
let propertyId: string;
let unitId: string;

beforeEach(async () => {
	db = await testDatabase();
	({ propertyId, unitId } = await seedUnit(db, 'a'));
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1]) {
	return outcome(() =>
		handler(routeEvent(db, { parent: { property: { id: propertyId } }, ...options }))
	);
}

async function createCircle(form: Record<string, string | string[]>, id = propertyId) {
	return run(actions.create, { params: { id }, form });
}

describe('abrechnungskreise', () => {
	it('creates a circle of the property’s units', async () => {
		expect(await createCircle({ name: 'Heizkreis', unitIds: [unitId] })).toEqual({
			redirect: `/objekte/${propertyId}/abrechnungskreise`
		});
		expect(await run(load, { params: { id: propertyId } })).toMatchObject({
			data: { circles: [{ name: 'Heizkreis', unitIds: [unitId] }], units: [{ id: unitId }] }
		});
	});

	it('refuses an empty circle, a foreign unit and a foreign property', async () => {
		expect(await createCircle({ name: 'Leer' })).toMatchObject({
			fail: 400,
			data: { errors: { unitIds: expect.any(String) } }
		});
		const other = await seedUnit(db, 'b');
		expect(await createCircle({ name: 'Fremd', unitIds: [other.unitId] })).toMatchObject({
			fail: 400,
			data: { errors: { unitIds: 'Eine der Einheiten gehört nicht zu diesem Objekt.' } }
		});
		expect(
			await createCircle({ name: 'Fremd', unitIds: [other.unitId] }, other.propertyId)
		).toMatchObject({ error: 404 });
	});
});

describe('abrechnungskreise/[circleId]', () => {
	let circleId: string;

	beforeEach(async () => {
		await createCircle({ name: 'Heizkreis', unitIds: [unitId] });
		circleId = (await listCircles(db, 'a', propertyId))[0].id;
	});

	it('answers 404 for a circle under another property', async () => {
		const second = await seedUnit(db, 'a', { propertyName: 'Zweites' });
		const params = { id: second.propertyId, circleId };
		expect(
			await run(loadCircle, { params, parent: { property: { id: second.propertyId } } })
		).toMatchObject({ error: 404 });
		expect(
			await run(circleActions.update, { params, form: { name: 'x', unitIds: [unitId] } })
		).toMatchObject({ error: 404 });
		expect(await run(circleActions.delete, { params, form: {} })).toMatchObject({ error: 404 });
	});

	it('renames, refuses foreign units and deletes the circle', async () => {
		const params = { id: propertyId, circleId };
		expect(await run(loadCircle, { params })).toMatchObject({
			data: { circle: { id: circleId }, units: [{ id: unitId }] }
		});
		expect(
			await run(circleActions.update, { params, form: { name: 'Haus', unitIds: [unitId] } })
		).toEqual({ redirect: `/objekte/${propertyId}/abrechnungskreise` });
		expect((await getCircle(db, 'a', circleId))?.name).toBe('Haus');
		const other = await seedUnit(db, 'b');
		expect(
			await run(circleActions.update, { params, form: { name: 'Haus', unitIds: [other.unitId] } })
		).toMatchObject({ fail: 400 });
		expect(await run(circleActions.update, { params, form: { name: '' } })).toMatchObject({
			fail: 400
		});
		expect(await run(circleActions.delete, { params, form: {} })).toEqual({
			redirect: `/objekte/${propertyId}/abrechnungskreise`
		});
		expect(await getCircle(db, 'a', circleId)).toBeUndefined();
	});
});
