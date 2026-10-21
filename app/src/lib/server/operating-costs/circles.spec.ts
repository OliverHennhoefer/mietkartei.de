import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db';
import {
	allocationKeys,
	auditLog,
	billingCircleUnits,
	costCategories,
	costItems,
	units
} from '../db/schema';
import { contextA, contextB, seedUnit, testDatabase } from '../testing';
import { createCircle, deleteCircle, getCircle, listCircles, updateCircle } from './circles';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

async function addUnit(accountId: string, propertyId: string, name: string) {
	const [unit] = await db
		.insert(units)
		.values({ accountId, propertyId, name, kind: 'parking', floorArea: null })
		.returning({ id: units.id });
	return unit.id;
}

describe('circles', () => {
	it('creates a circle with its units in one batch and logs it', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'a');
		const parking = await addUnit('a', propertyId, 'Stellplatz 1');
		const result = await createCircle(db, contextA, propertyId, {
			name: 'Wohnungen',
			unitIds: [unitId, unitId]
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(await getCircle(db, 'a', result.id)).toMatchObject({
			accountId: 'a',
			propertyId,
			propertyName: 'Haus',
			name: 'Wohnungen',
			unitIds: [unitId]
		});
		expect((await getCircle(db, 'a', result.id))!.unitIds).not.toContain(parking);
		const audit = await db.select().from(auditLog).where(eq(auditLog.entity, 'billing_circle'));
		expect(audit.map((entry) => [entry.action, entry.summary])).toEqual([
			['create', 'Abrechnungskreis Wohnungen angelegt']
		]);
	});

	it('refuses an unknown property and units of another property', async () => {
		const { propertyId } = await seedUnit(db, 'a');
		const { unitId: elsewhere } = await seedUnit(db, 'a', { propertyName: 'Anderes Haus' });
		expect(await createCircle(db, contextA, 'nope', { name: 'X', unitIds: [] })).toEqual({
			ok: false,
			reason: 'unknown-property'
		});
		expect(
			await createCircle(db, contextA, propertyId, { name: 'X', unitIds: [elsewhere] })
		).toEqual({ ok: false, reason: 'unknown-unit' });
	});

	it('lists the circles of the account and of one property, with their units by name', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'a', { name: 'EG' });
		const og = await addUnit('a', propertyId, 'OG');
		const other = await seedUnit(db, 'a', { propertyName: 'Anderes Haus' });
		const wohnungen = await createCircle(db, contextA, propertyId, {
			name: 'Wohnungen',
			unitIds: [og, unitId]
		});
		const alle = await createCircle(db, contextA, other.propertyId, {
			name: 'Alle',
			unitIds: [other.unitId]
		});
		if (!wohnungen.ok || !alle.ok) throw new Error('setup failed');

		const all = await listCircles(db, 'a');
		expect(all.map((circle) => [circle.propertyName, circle.name, circle.unitIds])).toEqual([
			['Anderes Haus', 'Alle', [other.unitId]],
			['Haus', 'Wohnungen', [unitId, og]]
		]);
		expect((await listCircles(db, 'a', propertyId)).map((circle) => circle.id)).toEqual([
			wohnungen.id
		]);
	});

	it('updates the name and replaces the units', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'a');
		const parking = await addUnit('a', propertyId, 'Stellplatz 1');
		const created = await createCircle(db, contextA, propertyId, {
			name: 'Wohnungen',
			unitIds: [unitId]
		});
		if (!created.ok) throw new Error('setup failed');
		expect(
			await updateCircle(db, contextA, created.id, { name: 'Stellplätze', unitIds: [parking] })
		).toEqual({ ok: true });
		expect(await getCircle(db, 'a', created.id)).toMatchObject({
			name: 'Stellplätze',
			unitIds: [parking]
		});
		expect(await db.select().from(billingCircleUnits)).toHaveLength(1);
	});

	it('deletes a circle; cost items that used it fall back to all units', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'a');
		const created = await createCircle(db, contextA, propertyId, {
			name: 'Wohnungen',
			unitIds: [unitId]
		});
		if (!created.ok) throw new Error('setup failed');
		const [category] = await db
			.insert(costCategories)
			.values({ accountId: 'a', name: 'Grundsteuer', billingCircleId: created.id })
			.returning({ id: costCategories.id });
		const [{ id: keyId }] = await db
			.insert(allocationKeys)
			.values({ accountId: 'a', name: 'Fläche', kind: 'area' })
			.returning({ id: allocationKeys.id });
		const [item] = await db
			.insert(costItems)
			.values({
				accountId: 'a',
				propertyId,
				categoryId: category.id,
				allocationKeyId: keyId,
				billingCircleId: created.id,
				description: 'Grundsteuer 2025',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 120000
			})
			.returning({ id: costItems.id });

		expect(await deleteCircle(db, contextA, created.id)).toBe('deleted');
		expect(await getCircle(db, 'a', created.id)).toBeUndefined();
		expect(await db.select().from(billingCircleUnits)).toEqual([]);
		const [after] = await db.select().from(costItems).where(eq(costItems.id, item.id));
		expect(after.billingCircleId).toBeNull();
		const [categoryAfter] = await db
			.select()
			.from(costCategories)
			.where(eq(costCategories.id, category.id));
		expect(categoryAfter.billingCircleId).toBeNull();
	});

	it('does not leak into another account', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'b');
		const foreign = await createCircle(db, contextB, propertyId, {
			name: 'Fremd',
			unitIds: [unitId]
		});
		if (!foreign.ok) throw new Error('setup failed');

		expect(await listCircles(db, 'a')).toEqual([]);
		expect(await listCircles(db, 'a', propertyId)).toEqual([]);
		expect(await getCircle(db, 'a', foreign.id)).toBeUndefined();
		expect(await updateCircle(db, contextA, foreign.id, { name: 'Neu', unitIds: [] })).toEqual({
			ok: false,
			reason: 'missing'
		});
		expect(await deleteCircle(db, contextA, foreign.id)).toBe('missing');
		expect(await createCircle(db, contextA, propertyId, { name: 'X', unitIds: [] })).toEqual({
			ok: false,
			reason: 'unknown-property'
		});
		expect(await getCircle(db, 'b', foreign.id)).toMatchObject({
			name: 'Fremd',
			unitIds: [unitId]
		});
		// Units of the other account cannot join a circle of account a.
		const own = await seedUnit(db, 'a');
		expect(
			await createCircle(db, contextA, own.propertyId, { name: 'X', unitIds: [unitId] })
		).toEqual({ ok: false, reason: 'unknown-unit' });
		const circle = await createCircle(db, contextA, own.propertyId, {
			name: 'Eigen',
			unitIds: [own.unitId]
		});
		if (!circle.ok) throw new Error('setup failed');
		expect(
			await updateCircle(db, contextA, circle.id, { name: 'Eigen', unitIds: [own.unitId, unitId] })
		).toEqual({ ok: false, reason: 'unknown-unit' });
		expect(await getCircle(db, 'a', circle.id)).toMatchObject({ unitIds: [own.unitId] });
	});
});
