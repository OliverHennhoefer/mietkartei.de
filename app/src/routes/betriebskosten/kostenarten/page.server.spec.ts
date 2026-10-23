import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import {
	ensureDefaults,
	getCategory,
	getCostItem,
	listCategories
} from '#lib/server/operating-costs.ts';
import { outcome, routeEvent, seedCostItem, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { actions as categoryActions, load as loadCategory } from './[id]/+page.server';
import { actions, load } from './+page.server';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

const fields = { name: 'Dachrinnenreinigung', betrkvItem: '17', allocable: 'on' };

function create(form: Record<string, string>) {
	return outcome(() => actions.create(routeEvent(db, { form })));
}

async function categoryNamed(name: string) {
	return (await listCategories(db, 'a')).find((category) => category.name === name)!;
}

describe('kostenarten', () => {
	it('seeds the standard list on first visit', async () => {
		const result = (await outcome(() => load(routeEvent(db)))) as {
			data: { categories: unknown[]; keys: unknown[] };
		};
		expect(result.data.categories.length).toBeGreaterThan(10);
		expect(result.data.keys.length).toBeGreaterThan(0);
	});

	it('creates a category and refuses a duplicate name or a foreign key', async () => {
		expect(await create(fields)).toEqual({ redirect: '/betriebskosten/kostenarten' });
		expect(await create(fields)).toMatchObject({
			fail: 400,
			data: { errors: { name: 'Eine Kostenart mit diesem Namen gibt es schon.' } }
		});
		expect(await create({ ...fields, name: 'Neu', allocationKeyId: 'fremd' })).toMatchObject({
			fail: 400,
			data: { errors: { allocationKeyId: expect.any(String) } }
		});
		expect(await create({ ...fields, name: '' })).toMatchObject({ fail: 400 });
	});
});

describe('kostenarten/[id]', () => {
	let id: string;

	beforeEach(async () => {
		await create(fields);
		id = (await categoryNamed('Dachrinnenreinigung')).id;
	});

	function act(action: 'update' | 'delete', form: Record<string, string>, categoryId = id) {
		return outcome(() =>
			categoryActions[action](routeEvent(db, { params: { id: categoryId }, form }))
		);
	}

	it('answers 404 for a category of another account', async () => {
		await ensureDefaults(db, 'b');
		const foreign = (await listCategories(db, 'b'))[0].id;
		expect(
			await outcome(() => loadCategory(routeEvent(db, { params: { id: foreign } })))
		).toMatchObject({ error: 404 });
		expect(await act('update', fields, foreign)).toMatchObject({ error: 404 });
		expect(await act('delete', {}, foreign)).toMatchObject({ error: 404 });
	});

	it('renames a category', async () => {
		expect(await outcome(() => loadCategory(routeEvent(db, { params: { id } })))).toMatchObject({
			data: { category: { name: 'Dachrinnenreinigung' } }
		});
		expect(await act('update', { ...fields, name: 'Dachrinne' })).toEqual({
			redirect: '/betriebskosten/kostenarten'
		});
		expect((await getCategory(db, 'a', id))?.name).toBe('Dachrinne');
		const [other] = (await listCategories(db, 'a')).filter((category) => category.id !== id);
		expect(await act('update', { ...fields, name: other.name })).toMatchObject({ fail: 400 });
		expect(await act('update', { ...fields, betrkvItem: '99' })).toMatchObject({ fail: 400 });
	});

	it('deletes an unused category and keeps one with cost items', async () => {
		const { propertyId } = await seedUnit(db, 'a');
		const item = await getCostItem(db, 'a', await seedCostItem(db, 'a', propertyId));
		const used = item!.categoryId;
		expect(await act('delete', {}, used)).toEqual({
			fail: 400,
			data: { refused: expect.stringMatching(/von 1\sBeleg verwendet/) }
		});
		expect(await act('delete', {})).toEqual({ redirect: '/betriebskosten/kostenarten' });
		expect(await getCategory(db, 'a', id)).toBeUndefined();
	});
});
