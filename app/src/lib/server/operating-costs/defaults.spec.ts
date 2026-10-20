import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db';
import { allocationKeys, auditLog, costCategories } from '../db/schema';
import { testDatabase } from '../testing';
import {
	defaultCategories,
	defaultKeys,
	defaultLandlordCategories,
	ensureDefaults
} from './defaults';

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
		expect(await ensureDefaults(db, 'a')).toEqual({
			categoriesInserted: 19,
			keysInserted: 6,
			categoriesDefaulted: 17
		});

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

	it('gives every allocable category its default key: heating, hot water, waste, area', async () => {
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
			['Verbundene Heizungs- und Warmwasserversorgung', 'Heizung 70/30'],
			['Aufzug', 'Wohnfläche'],
			['Straßenreinigung und Müllbeseitigung', 'Personen'],
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

	it('is idempotent and only fills in what is missing', async () => {
		await ensureDefaults(db, 'a');
		expect(await ensureDefaults(db, 'a')).toEqual({
			categoriesInserted: 0,
			keysInserted: 0,
			categoriesDefaulted: 0
		});
		expect(await categoriesOf('a')).toHaveLength(19);
		expect(await keysOf('a')).toHaveLength(6);

		// A category that existed before (e.g. imported) keeps its row and gets a default key;
		// a key the user removed comes back.
		await db
			.delete(allocationKeys)
			.where(eq(allocationKeys.name, 'Einheiten'))
			.then(() =>
				db
					.update(costCategories)
					.set({ allocationKeyId: null })
					.where(eq(costCategories.name, 'Aufzug'))
			);
		expect(await ensureDefaults(db, 'a')).toEqual({
			categoriesInserted: 0,
			keysInserted: 1,
			categoriesDefaulted: 1
		});
		const keyName = new Map((await keysOf('a')).map((row) => [row.id, row.name]));
		const [aufzug] = (await categoriesOf('a')).filter((row) => row.name === 'Aufzug');
		expect(keyName.get(aufzug.allocationKeyId!)).toBe('Wohnfläche');
		expect(await keysOf('a')).toHaveLength(6);
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
