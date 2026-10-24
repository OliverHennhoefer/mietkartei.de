import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { getProperty, getUnit } from '#lib/server/properties.ts';
import { outcome, routeEvent, seedLease, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { load as loadProperty } from './[id]/+layout.server';
import { actions as propertyActions, load as loadUnits } from './[id]/+page.server';
import { actions as editActions, load as loadEdit } from './[id]/bearbeiten/+page.server';
import { actions as unitActions, load as loadUnit } from './[id]/einheiten/[unitId]/+page.server';
import {
	actions as unitEditActions,
	load as loadUnitEdit
} from './[id]/einheiten/[unitId]/bearbeiten/+page.server';
import { actions as newActions, load as loadNew } from './neu/+page.server';
import { load } from './+page.server';

// The property pages: list, new, the property with its units, editing and deleting both.

let db: Database;
let propertyId: string;
let unitId: string;

beforeEach(async () => {
	db = await testDatabase();
	({ propertyId, unitId } = await seedUnit(db, 'a'));
});

const property = { name: 'Gartenhaus', street: 'Weg 2', postalCode: '10115', city: 'Berlin' };
const unit = { name: 'DG', kind: 'apartment', floorArea: '48,5' };

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1]) {
	return outcome(() => handler(routeEvent(db, options)));
}

describe('objekte', () => {
	it('lists the properties of the account only', async () => {
		await seedUnit(db, 'b', { propertyName: 'Fremd' });
		expect(await run(load, {})).toMatchObject({ data: { properties: [{ id: propertyId }] } });
	});

	it('creates a property and opens it', async () => {
		expect(await run(loadNew, {})).toEqual({ data: {} });
		expect(await run(loadNew, { user: null })).toEqual({ redirect: '/anmelden' });
		const result = await run(newActions.create, { form: property });
		const id = 'redirect' in result ? result.redirect.split('/').at(-1)! : '';
		expect((await getProperty(db, 'a', id))?.name).toBe('Gartenhaus');
		expect(await run(newActions.create, { form: { ...property, postalCode: '1' } })).toMatchObject({
			fail: 400,
			data: { errors: { postalCode: expect.any(String) } }
		});
	});

	it('answers 404 for every page and action of another account’s property', async () => {
		const other = await seedUnit(db, 'b');
		const params = { id: other.propertyId, unitId: other.unitId };
		expect(await run(loadProperty, { params })).toMatchObject({ error: 404 });
		expect(await run(propertyActions.createUnit, { params, form: unit })).toMatchObject({
			error: 404
		});
		expect(await run(editActions.update, { params, form: property })).toMatchObject({ error: 404 });
		expect(await run(editActions.delete, { params, form: {} })).toMatchObject({ error: 404 });
		expect(await run(loadUnit, { params })).toMatchObject({ error: 404 });
		expect(await run(unitActions.delete, { params, form: {} })).toMatchObject({ error: 404 });
		expect(await run(loadUnitEdit, { params })).toMatchObject({ error: 404 });
		expect(await run(unitEditActions.update, { params, form: unit })).toMatchObject({ error: 404 });
	});

	it('answers 404 for a unit under another property of the same account', async () => {
		const second = await seedUnit(db, 'a', { propertyName: 'Zweites' });
		const params = { id: propertyId, unitId: second.unitId };
		expect(await run(loadUnit, { params })).toMatchObject({ error: 404 });
		expect(await run(unitEditActions.update, { params, form: unit })).toMatchObject({ error: 404 });
		expect(await run(unitActions.delete, { params, form: {} })).toMatchObject({ error: 404 });
	});
});

describe('objekte/[id]', () => {
	const params = () => ({ id: propertyId, unitId });

	it('adds units and lists them with their occupancy', async () => {
		expect(await run(propertyActions.createUnit, { params: params(), form: unit })).toEqual({
			data: { created: 'DG' }
		});
		expect(
			await run(propertyActions.createUnit, { params: params(), form: { ...unit, kind: 'burg' } })
		).toMatchObject({ fail: 400 });
		expect(await run(loadUnits, { params: params() })).toMatchObject({
			data: { units: [expect.anything(), expect.anything()] }
		});
	});

	it('updates the property', async () => {
		expect(await run(editActions.update, { params: params(), form: property })).toEqual({
			redirect: `/objekte/${propertyId}`
		});
		expect((await getProperty(db, 'a', propertyId))?.name).toBe('Gartenhaus');
		expect(
			await run(editActions.update, { params: params(), form: { ...property, city: '' } })
		).toMatchObject({ fail: 400 });
	});

	it('keeps a property and unit with a lease and names the lease', async () => {
		const leaseId = await seedLease(db, 'a', unitId);
		expect(await run(loadEdit, { params: params() })).toMatchObject({
			data: {
				deletion: {
					blockers: [
						{
							links: [{ href: `/vertraege/${leaseId}`, label: expect.stringContaining('EG links') }]
						}
					]
				}
			}
		});
		expect(await run(editActions.delete, { params: params(), form: {} })).toMatchObject({
			fail: 400,
			data: { deleteError: expect.any(String) }
		});
		expect(await run(unitActions.delete, { params: params(), form: {} })).toMatchObject({
			fail: 400,
			data: { deleteError: expect.any(String) }
		});
		expect(await run(loadUnit, { params: params() })).toMatchObject({
			data: {
				unit: { id: unitId },
				leases: [{ id: leaseId, main: true }],
				deletion: { blockers: [{ links: [{ href: `/vertraege/${leaseId}` }] }] }
			}
		});
	});

	it('edits and deletes a unit, then the property', async () => {
		expect(await run(loadUnitEdit, { params: params() })).toMatchObject({
			data: { unit: { id: unitId } }
		});
		expect(await run(unitEditActions.update, { params: params(), form: unit })).toEqual({
			redirect: `/objekte/${propertyId}/einheiten/${unitId}`
		});
		expect(
			await run(unitEditActions.update, { params: params(), form: { ...unit, name: '' } })
		).toMatchObject({ fail: 400 });
		expect((await getUnit(db, 'a', unitId))?.name).toBe('DG');
		expect(await run(unitActions.delete, { params: params(), form: {} })).toEqual({
			redirect: `/objekte/${propertyId}`
		});
		expect(await run(editActions.delete, { params: params(), form: {} })).toEqual({
			redirect: '/objekte'
		});
		expect(await getProperty(db, 'a', propertyId)).toBeUndefined();
	});
});
