import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db';
import { accounts, allocationKeys, auditLog, costCategories } from '../db/schema';
import { contextA, testDatabase } from '../testing';
import { createCategory } from './categories';
import {
	defaultCategories,
	defaultKeys,
	defaultLandlordCategories,
	ensureDefaults
} from './defaults';
import { createKey } from './keys';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

async function categoriesOf(accountId: string) {
	return db
		.select()
		.from(costCategories)
		.where(eq(costCategories.accountId, accountId))
		.orderBy(asc(costCategories.sortOrder));
}

async function keysOf(accountId: string) {
	return db.select().from(allocationKeys).where(eq(allocationKeys.accountId, accountId));
}

describe('ensureDefaults', () => {
	it('seeds the 17 BetrKV items, two landlord categories and six keys, in order', async () => {
		expect(await ensureDefaults(db, 'a')).toBe(true);

		const categories = await categoriesOf('a');
		expect(categories.map((row) => [row.betrkvItem, row.name])).toEqual([
			[1, 'Grundsteuer'],
			[2, 'Wasserversorgung'],
			[3, 'Entwässerung'],
			[4, 'Heizung'],
			[5, 'Warmwasser'],
			[6, 'Verbundene Heizungs- und Warmwasserversorgung'],
			[7, 'Aufzug'],
			[8, 'Straßenreinigung und Müllbeseitigung'],
			[9, 'Gebäudereinigung und Ungezieferbekämpfung'],
			[10, 'Gartenpflege'],
			[11, 'Beleuchtung'],
			[12, 'Schornsteinreinigung'],
			[13, 'Sach- und Haftpflichtversicherung'],
			[14, 'Hauswart'],
			[15, 'Gemeinschaftsantenne und Breitbandnetz'],
			[16, 'Wascheinrichtungen'],
			[17, 'Sonstige Betriebskosten'],
			[null, 'Verwaltungskosten (nicht umlagefähig)'],
			[null, 'Instandhaltung (nicht umlagefähig)']
		]);
		expect(categories.filter((row) => row.consumptionBased).map((row) => row.betrkvItem)).toEqual([
			4, 5, 6
		]);
		expect(categories.filter((row) => !row.allocable).map((row) => row.sortOrder)).toEqual([
			18, 19
		]);
		expect(defaultCategories).toHaveLength(17);
		expect(defaultLandlordCategories).toHaveLength(2);

		const keys = await keysOf('a');
		expect(keys.map((row) => [row.name, row.kind, row.meterKind, row.consumptionPercent])).toEqual([
			['Wohnfläche', 'area', null, null],
			['Personen', 'persons', null, null],
			['Einheiten', 'units', null, null],
			['Heizung 70/30', 'mixed', 'heat', 70],
			['Warmwasser 70/30', 'mixed', 'hot_water', 70],
			['Beträge je Einheit', 'direct', null, null]
		]);
		expect(keys.every((row) => row.propertyId === null)).toBe(true);
		expect(defaultKeys).toHaveLength(6);
	});

	it('gives heating and hot water their HeizKV key, a combined system none, the rest area', async () => {
		await ensureDefaults(db, 'a');
		const keyName = new Map((await keysOf('a')).map((row) => [row.id, row.name]));
		const defaults = (await categoriesOf('a')).map((row) => [
			row.name,
			row.allocationKeyId ? keyName.get(row.allocationKeyId) : null
		]);
		expect(defaults).toEqual([
			['Grundsteuer', 'Wohnfläche'],
			['Wasserversorgung', 'Wohnfläche'],
			['Entwässerung', 'Wohnfläche'],
			['Heizung', 'Heizung 70/30'],
			['Warmwasser', 'Warmwasser 70/30'],
			['Verbundene Heizungs- und Warmwasserversorgung', null],
			['Aufzug', 'Wohnfläche'],
			['Straßenreinigung und Müllbeseitigung', 'Wohnfläche'],
			['Gebäudereinigung und Ungezieferbekämpfung', 'Wohnfläche'],
			['Gartenpflege', 'Wohnfläche'],
			['Beleuchtung', 'Wohnfläche'],
			['Schornsteinreinigung', 'Wohnfläche'],
			['Sach- und Haftpflichtversicherung', 'Wohnfläche'],
			['Hauswart', 'Wohnfläche'],
			['Gemeinschaftsantenne und Breitbandnetz', 'Wohnfläche'],
			['Wascheinrichtungen', 'Wohnfläche'],
			['Sonstige Betriebskosten', 'Wohnfläche'],
			['Verwaltungskosten (nicht umlagefähig)', null],
			['Instandhaltung (nicht umlagefähig)', null]
		]);
	});

	it('seeds only once, so changes the landlord makes to the standard list stay', async () => {
		await ensureDefaults(db, 'a');
		expect(await ensureDefaults(db, 'a')).toBe(false);
		expect(await categoriesOf('a')).toHaveLength(19);
		expect(await keysOf('a')).toHaveLength(6);

		// A renamed category, a deleted category and key, and a category set to no key.
		await db
			.update(costCategories)
			.set({ name: 'Sonstige: Dachrinnenreinigung' })
			.where(eq(costCategories.name, 'Sonstige Betriebskosten'));
		await db.delete(costCategories).where(eq(costCategories.name, 'Aufzug'));
		await db
			.update(costCategories)
			.set({ allocationKeyId: null })
			.where(eq(costCategories.name, 'Grundsteuer'));
		await db.delete(allocationKeys).where(eq(allocationKeys.name, 'Einheiten'));
		const before = await categoriesOf('a');

		expect(await ensureDefaults(db, 'a')).toBe(false);
		const after = await categoriesOf('a');
		expect(after).toEqual(before);
		expect(after.map((row) => row.name)).not.toContain('Sonstige Betriebskosten');
		expect(after.map((row) => row.name)).not.toContain('Aufzug');
		expect(after.find((row) => row.name === 'Grundsteuer')?.allocationKeyId).toBeNull();
		expect((await keysOf('a')).map((row) => row.name)).not.toContain('Einheiten');
	});

	it('does not seed again when the landlord removed every category and key', async () => {
		await ensureDefaults(db, 'a');
		await db.delete(costCategories).where(eq(costCategories.accountId, 'a'));
		await db.delete(allocationKeys).where(eq(allocationKeys.accountId, 'a'));

		expect(await ensureDefaults(db, 'a')).toBe(false);
		expect(await categoriesOf('a')).toEqual([]);
		expect(await keysOf('a')).toEqual([]);
	});

	it('seeds around a key and a category the landlord gave a default name before', async () => {
		// The key and category pages create entries without seeding first.
		const own = await createKey(db, contextA, {
			name: 'Wohnfläche',
			kind: 'units',
			propertyId: null,
			meterKind: null,
			consumptionPercent: null
		});
		const grundsteuer = await createCategory(db, contextA, {
			name: 'Grundsteuer',
			betrkvItem: 1,
			allocable: true,
			consumptionBased: false,
			allocationKeyId: null,
			billingCircleId: null,
			sortOrder: 1
		});
		if (!own.ok || !grundsteuer.ok) throw new Error('setup failed');

		expect(await ensureDefaults(db, 'a')).toBe(true);
		const [account] = await db
			.select({ seeded: accounts.operatingCostDefaultsSeeded })
			.from(accounts)
			.where(eq(accounts.id, 'a'));
		expect(account.seeded).toBe(true);
		expect(await ensureDefaults(db, 'a')).toBe(false);

		const keys = await keysOf('a');
		expect(keys).toHaveLength(6);
		expect(keys.find((row) => row.name === 'Wohnfläche')).toMatchObject({
			id: own.id,
			kind: 'units'
		});
		const keyIds = new Set(keys.map((row) => row.id));
		const categories = await categoriesOf('a');
		expect(categories).toHaveLength(19);
		expect(
			categories.every((row) => row.allocationKeyId === null || keyIds.has(row.allocationKeyId))
		).toBe(true);
		expect(categories.find((row) => row.name === 'Grundsteuer')).toMatchObject({
			id: grundsteuer.id,
			allocationKeyId: null
		});
		expect(categories.find((row) => row.name === 'Wasserversorgung')?.allocationKeyId).toBe(own.id);
	});

	it('writes no audit lines: the standard list is not a change the landlord made', async () => {
		await ensureDefaults(db, 'a');
		expect(await db.select().from(auditLog)).toEqual([]);
	});

	it('seeds one account without touching another', async () => {
		await ensureDefaults(db, 'a');
		expect(await categoriesOf('b')).toEqual([]);
		expect(await keysOf('b')).toEqual([]);

		await ensureDefaults(db, 'b');
		expect(await categoriesOf('b')).toHaveLength(19);
		const keysA = new Set((await keysOf('a')).map((row) => row.id));
		const categoriesB = await categoriesOf('b');
		expect(
			categoriesB.every((row) => !row.allocationKeyId || !keysA.has(row.allocationKeyId))
		).toBe(true);
	});
});
