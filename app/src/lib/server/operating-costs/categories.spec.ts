import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db';
import { auditLog } from '../db/schema';
import { contextA, contextB, seedUnit, testDatabase } from '../testing';
import {
	createCategory,
	deleteCategory,
	getCategory,
	listCategories,
	updateCategory,
	type CostCategoryInput
} from './categories';
import { createCircle } from './circles';
import { ensureDefaults } from './defaults';
import { createKey } from './keys';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

function input(overrides: Partial<CostCategoryInput> = {}): CostCategoryInput {
	return {
		name: 'Fahrstuhlwartung',
		betrkvItem: 7,
		allocable: true,
		consumptionBased: false,
		allocationKeyId: null,
		billingCircleId: null,
		sortOrder: 7,
		...overrides
	};
}

async function create(context: typeof contextA, overrides: Partial<CostCategoryInput> = {}) {
	const result = await createCategory(db, context, input(overrides));
	if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
	return result.id;
}

describe('categories', () => {
	it('creates a category with its key and circle and logs it', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'a');
		const key = await createKey(db, contextA, {
			name: 'Stellplätze',
			kind: 'units',
			propertyId: null,
			meterKind: null,
			consumptionPercent: null
		});
		const circle = await createCircle(db, contextA, propertyId, {
			name: 'Haus A',
			unitIds: [unitId]
		});
		if (!key.ok || !circle.ok) throw new Error('setup failed');

		const id = await create(contextA, { allocationKeyId: key.id, billingCircleId: circle.id });
		expect(await getCategory(db, 'a', id)).toMatchObject({
			accountId: 'a',
			name: 'Fahrstuhlwartung',
			betrkvItem: 7,
			allocable: true,
			consumptionBased: false,
			allocationKeyId: key.id,
			billingCircleId: circle.id,
			sortOrder: 7
		});
		const audit = await db.select().from(auditLog).where(eq(auditLog.entity, 'cost_category'));
		expect(audit.map((entry) => [entry.accountId, entry.action, entry.summary])).toEqual([
			['a', 'create', 'Kostenart Fahrstuhlwartung angelegt']
		]);
	});

	it('refuses a second category of the same name and unknown keys or circles', async () => {
		await create(contextA);
		expect(await createCategory(db, contextA, input())).toEqual({
			ok: false,
			reason: 'duplicate-name'
		});
		expect(
			await createCategory(db, contextA, input({ name: 'X', allocationKeyId: 'nope' }))
		).toEqual({ ok: false, reason: 'unknown-key' });
		expect(
			await createCategory(db, contextA, input({ name: 'X', billingCircleId: 'nope' }))
		).toEqual({ ok: false, reason: 'unknown-circle' });
	});

	it('lists the categories in sort order', async () => {
		await ensureDefaults(db, 'a');
		await create(contextA, { name: 'Zwischen 1 und 2', sortOrder: 1 });

		const listed = await listCategories(db, 'a');
		expect(listed.map((row) => row.name).slice(0, 3)).toEqual([
			'Grundsteuer',
			'Zwischen 1 und 2',
			'Wasserversorgung'
		]);
		expect(listed).toHaveLength(20);
	});

	it('updates every field and refuses a name another category has', async () => {
		const id = await create(contextA);
		const other = await create(contextA, { name: 'Andere' });
		const changed = input({
			name: 'Aufzugwartung',
			betrkvItem: null,
			allocable: false,
			consumptionBased: true,
			sortOrder: 42
		});
		expect(await updateCategory(db, contextA, id, changed)).toEqual({ ok: true });
		expect(await getCategory(db, 'a', id)).toMatchObject(changed);
		expect(await updateCategory(db, contextA, id, input({ name: 'Andere' }))).toEqual({
			ok: false,
			reason: 'duplicate-name'
		});
		// Keeping the own name is not a duplicate.
		expect(await updateCategory(db, contextA, other, input({ name: 'Andere' }))).toEqual({
			ok: true
		});
	});

	it('deletes a category and logs it', async () => {
		const id = await create(contextA);
		expect(await deleteCategory(db, contextA, id)).toBe('deleted');
		expect(await getCategory(db, 'a', id)).toBeUndefined();
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'delete'));
		expect(audit.map((entry) => entry.summary)).toEqual(['Kostenart Fahrstuhlwartung gelöscht']);
	});

	it('does not leak into another account', async () => {
		const foreign = await create(contextB);
		expect(await listCategories(db, 'a')).toEqual([]);
		expect(await getCategory(db, 'a', foreign)).toBeUndefined();
		expect(await updateCategory(db, contextA, foreign, input({ name: 'Neu' }))).toEqual({
			ok: false,
			reason: 'missing'
		});
		expect(await deleteCategory(db, contextA, foreign)).toBe('missing');
		expect(await getCategory(db, 'b', foreign)).toMatchObject({ name: 'Fahrstuhlwartung' });
		// The same name is free in the other account.
		expect((await createCategory(db, contextA, input())).ok).toBe(true);
		// A key of the other account cannot become a default.
		const key = await createKey(db, contextB, {
			name: 'Fremd',
			kind: 'area',
			propertyId: null,
			meterKind: null,
			consumptionPercent: null
		});
		if (!key.ok) throw new Error('setup failed');
		expect(
			await createCategory(
				db,
				contextA,
				input({ name: 'Mit fremdem Schlüssel', allocationKeyId: key.id })
			)
		).toEqual({ ok: false, reason: 'unknown-key' });
	});
});
