import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db';
import { allocationKeyShares, auditLog, costCategories, costItems, units } from '../db/schema';
import { contextA, contextB, seedUnit, testDatabase } from '../testing';
import {
	createKey,
	deleteKey,
	getKey,
	listKeyShares,
	listKeys,
	replaceKeyShares,
	updateKey,
	type AllocationKeyInput
} from './keys';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

function input(overrides: Partial<AllocationKeyInput> = {}): AllocationKeyInput {
	return {
		name: 'Miteigentumsanteile',
		kind: 'custom',
		propertyId: null,
		meterKind: null,
		consumptionPercent: null,
		...overrides
	};
}

async function create(context: typeof contextA, overrides: Partial<AllocationKeyInput> = {}) {
	const result = await createKey(db, context, input(overrides));
	if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
	return result.id;
}

/** A second unit in the property, for shares. */
async function addUnit(accountId: string, propertyId: string, name: string) {
	const [unit] = await db
		.insert(units)
		.values({ accountId, propertyId, name, kind: 'apartment', floorArea: 50 })
		.returning({ id: units.id });
	return unit.id;
}

describe('keys', () => {
	it('creates a key for one property and logs it', async () => {
		const { propertyId } = await seedUnit(db, 'a');
		const id = await create(contextA, { propertyId });
		expect(await getKey(db, 'a', id)).toMatchObject({
			accountId: 'a',
			name: 'Miteigentumsanteile',
			kind: 'custom',
			propertyId,
			propertyName: 'Haus',
			meterKind: null,
			consumptionPercent: null,
			costItemCount: 0
		});
		const audit = await db.select().from(auditLog).where(eq(auditLog.entity, 'allocation_key'));
		expect(audit.map((entry) => [entry.accountId, entry.action, entry.summary])).toEqual([
			['a', 'create', 'Umlageschlüssel Miteigentumsanteile angelegt']
		]);
	});

	it('keeps the meter kind only for consumption and mixed keys, the percent only for mixed', async () => {
		const consumption = await create(contextA, {
			name: 'Kaltwasser',
			kind: 'consumption',
			meterKind: 'cold_water',
			consumptionPercent: 60
		});
		expect(await getKey(db, 'a', consumption)).toMatchObject({
			meterKind: 'cold_water',
			consumptionPercent: null
		});
		const area = await create(contextA, {
			name: 'Fläche',
			kind: 'area',
			meterKind: 'heat',
			consumptionPercent: 60
		});
		expect(await getKey(db, 'a', area)).toMatchObject({
			meterKind: null,
			consumptionPercent: null
		});
		const mixed = await create(contextA, {
			name: 'Heizung 60/40',
			kind: 'mixed',
			meterKind: 'heat',
			consumptionPercent: 60
		});
		expect(await getKey(db, 'a', mixed)).toMatchObject({
			meterKind: 'heat',
			consumptionPercent: 60
		});
	});

	it('refuses a duplicate name and a property of another account', async () => {
		await create(contextA);
		expect(await createKey(db, contextA, input())).toEqual({ ok: false, reason: 'duplicate-name' });
		const { propertyId } = await seedUnit(db, 'b');
		expect(await createKey(db, contextA, input({ name: 'X', propertyId }))).toEqual({
			ok: false,
			reason: 'unknown-property'
		});
	});

	it('lists the keys oldest first with their property and cost item counts', async () => {
		const { propertyId } = await seedUnit(db, 'a');
		const first = await create(contextA, { name: 'Erster', kind: 'area' });
		const second = await create(contextA, { name: 'Zweiter', kind: 'units', propertyId });
		const [category] = await db
			.insert(costCategories)
			.values({ accountId: 'a', name: 'Grundsteuer' })
			.returning({ id: costCategories.id });
		await db.insert(costItems).values({
			accountId: 'a',
			propertyId,
			categoryId: category.id,
			allocationKeyId: second,
			description: 'Grundsteuer 2025',
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			amount: 120000
		});
		const keys = await listKeys(db, 'a');
		expect(keys.map((key) => [key.id, key.propertyName, key.costItemCount])).toEqual([
			[first, null, 0],
			[second, 'Haus', 1]
		]);
	});

	it('updates a key and drops its shares when it stops being a custom key of that property', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'a');
		const id = await create(contextA, { propertyId });
		expect(await replaceKeyShares(db, contextA, id, [{ unitId, share: 250 }])).toBe('updated');

		expect(await updateKey(db, contextA, id, input({ name: 'MEA', propertyId }))).toEqual({
			ok: true
		});
		expect(await listKeyShares(db, 'a', id)).toEqual([{ unitId, share: 250 }]);

		expect(
			await updateKey(db, contextA, id, input({ name: 'MEA', kind: 'area', propertyId }))
		).toEqual({ ok: true });
		expect(await listKeyShares(db, 'a', id)).toEqual([]);
	});

	it('replaces the shares in one batch, only for units of the property', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'a');
		const other = await addUnit('a', propertyId, 'OG');
		const { unitId: foreignUnit } = await seedUnit(db, 'b');
		const id = await create(contextA, { propertyId });

		expect(
			await replaceKeyShares(db, contextA, id, [
				{ unitId, share: 300 },
				{ unitId: other, share: 700 }
			])
		).toBe('updated');
		expect(await listKeyShares(db, 'a', id)).toEqual([
			{ unitId, share: 300 },
			{ unitId: other, share: 700 }
		]);

		expect(await replaceKeyShares(db, contextA, id, [{ unitId: foreignUnit, share: 1 }])).toBe(
			'unknown-unit'
		);
		expect(await listKeyShares(db, 'a', id)).toHaveLength(2);

		// Zero drops the row; the rest is replaced.
		expect(
			await replaceKeyShares(db, contextA, id, [
				{ unitId, share: 0 },
				{ unitId: other, share: 1000 }
			])
		).toBe('updated');
		expect(await listKeyShares(db, 'a', id)).toEqual([{ unitId: other, share: 1000 }]);

		const area = await create(contextA, { name: 'Fläche', kind: 'area' });
		expect(await replaceKeyShares(db, contextA, area, [{ unitId, share: 1 }])).toBe('not-custom');
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'update'));
		expect(audit.map((entry) => entry.summary)).toEqual([
			'Anteile des Umlageschlüssels Miteigentumsanteile geändert',
			'Anteile des Umlageschlüssels Miteigentumsanteile geändert'
		]);
	});

	it('deletes a key with its shares; a category that named it keeps no default', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'a');
		const id = await create(contextA, { propertyId });
		await replaceKeyShares(db, contextA, id, [{ unitId, share: 1 }]);
		const [category] = await db
			.insert(costCategories)
			.values({ accountId: 'a', name: 'Grundsteuer', allocationKeyId: id })
			.returning({ id: costCategories.id });

		expect(await deleteKey(db, contextA, id)).toBe('deleted');
		expect(await getKey(db, 'a', id)).toBeUndefined();
		expect(await db.select().from(allocationKeyShares)).toEqual([]);
		const [after] = await db
			.select()
			.from(costCategories)
			.where(eq(costCategories.id, category.id));
		expect(after.allocationKeyId).toBeNull();
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'delete'));
		expect(audit.map((entry) => entry.summary)).toEqual([
			'Umlageschlüssel Miteigentumsanteile gelöscht'
		]);
	});

	it('refuses to delete a key that cost items use and deletes an unused one', async () => {
		const { propertyId } = await seedUnit(db, 'a');
		const used = await create(contextA, { name: 'Benutzt', kind: 'area' });
		const unused = await create(contextA, { name: 'Unbenutzt', kind: 'area' });
		const [category] = await db
			.insert(costCategories)
			.values({ accountId: 'a', name: 'Grundsteuer' })
			.returning({ id: costCategories.id });
		await db.insert(costItems).values({
			accountId: 'a',
			propertyId,
			categoryId: category.id,
			allocationKeyId: used,
			description: 'Grundsteuer 2025',
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			amount: 120000
		});
		expect(await deleteKey(db, contextA, used)).toBe('in-use');
		expect(await deleteKey(db, contextA, unused)).toBe('deleted');
		expect(await getKey(db, 'a', unused)).toBeUndefined();
	});

	it('does not leak into another account', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'b');
		const foreign = await create(contextB, { propertyId });
		await replaceKeyShares(db, contextB, foreign, [{ unitId, share: 1 }]);

		expect(await listKeys(db, 'a')).toEqual([]);
		expect(await getKey(db, 'a', foreign)).toBeUndefined();
		expect(await listKeyShares(db, 'a', foreign)).toEqual([]);
		expect(await updateKey(db, contextA, foreign, input({ name: 'Neu' }))).toEqual({
			ok: false,
			reason: 'missing'
		});
		expect(await replaceKeyShares(db, contextA, foreign, [])).toBe('missing');
		expect(await deleteKey(db, contextA, foreign)).toBe('missing');
		expect(await getKey(db, 'b', foreign)).toBeDefined();
		expect(await db.select().from(allocationKeyShares)).toHaveLength(1);
	});
});
