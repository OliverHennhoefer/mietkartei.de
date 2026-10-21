import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db';
import { auditLog, costItems } from '../db/schema';
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
			sortOrder: 7,
			costItemCount: 0
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

	it('lists the categories in sort order with their cost item counts', async () => {
		await ensureDefaults(db, 'a');
		const { propertyId } = await seedUnit(db, 'a');
		const categories = await listCategories(db, 'a');
		const grundsteuer = categories.find((row) => row.name === 'Grundsteuer')!;
		await db.insert(costItems).values([
			{
				accountId: 'a',
				propertyId,
				categoryId: grundsteuer.id,
				allocationKeyId: grundsteuer.allocationKeyId!,
				description: 'Grundsteuer 2025',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 120000
			},
			{
				accountId: 'a',
				propertyId,
				categoryId: grundsteuer.id,
				allocationKeyId: grundsteuer.allocationKeyId!,
				description: 'Grundsteuer 2024',
				periodStart: '2024-01-01',
				periodEnd: '2024-12-31',
				amount: 110000
			}
		]);
		const custom = await create(contextA, { name: 'Zwischen 1 und 2', sortOrder: 1 });

		const listed = await listCategories(db, 'a');
		expect(listed.map((row) => row.name).slice(0, 3)).toEqual([
			'Grundsteuer',
			'Zwischen 1 und 2',
			'Wasserversorgung'
		]);
		expect(listed.find((row) => row.id === grundsteuer.id)!.costItemCount).toBe(2);
		expect(listed.find((row) => row.id === custom)!.costItemCount).toBe(0);
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

	it('refuses to delete a category that cost items use', async () => {
		const { propertyId } = await seedUnit(db, 'a');
		const id = await create(contextA);
		const key = await createKey(db, contextA, {
			name: 'Fläche',
			kind: 'area',
			propertyId: null,
			meterKind: null,
			consumptionPercent: null
		});
		if (!key.ok) throw new Error('setup failed');
		await db.insert(costItems).values({
			accountId: 'a',
			propertyId,
			categoryId: id,
			allocationKeyId: key.id,
			description: 'Wartung',
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			amount: 50000
		});
		expect(await deleteCategory(db, contextA, id)).toBe('in-use');
		expect(await getCategory(db, 'a', id)).toBeDefined();
	});

	it('deletes an unused category and logs it', async () => {
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
		const own = await create(contextA, { name: 'Eigene' });
		expect(
			await updateCategory(db, contextA, own, input({ name: 'Eigene', allocationKeyId: key.id }))
		).toEqual({
			ok: false,
			reason: 'unknown-key'
		});
		// Nor can a billing circle of the other account.
		const { propertyId, unitId } = await seedUnit(db, 'b');
		const circle = await createCircle(db, contextB, propertyId, {
			name: 'Fremder Kreis',
			unitIds: [unitId]
		});
		if (!circle.ok) throw new Error('setup failed');
		expect(
			await createCategory(
				db,
				contextA,
				input({ name: 'Mit fremdem Kreis', billingCircleId: circle.id })
			)
		).toEqual({ ok: false, reason: 'unknown-circle' });
		expect(
			await updateCategory(db, contextA, own, input({ name: 'Eigene', billingCircleId: circle.id }))
		).toEqual({
			ok: false,
			reason: 'unknown-circle'
		});
		expect(await getCategory(db, 'a', own)).toMatchObject({
			allocationKeyId: null,
			billingCircleId: null
		});
	});
});
