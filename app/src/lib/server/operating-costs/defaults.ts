import { eq } from 'drizzle-orm';
import type { Database } from '../db';
import { chunk, rowsPerStatement, runBatch } from '../db/batch';
import {
	accounts,
	allocationKeys,
	costCategories,
	type AllocationKeyKind,
	type MeterKind
} from '../db/schema';

// The categories and keys every account starts with: the 17 items of § 2 BetrKV, two landlord
// categories that are never allocated, and the keys the BetrKV and the HeizKV name. Seeded once,
// on first use of any operating costs page, and marked on the account; `onConflictDoNothing` on
// the unique (account, name) indexes keeps two racing first requests harmless.

export type DefaultCategory = {
	name: string;
	betrkvItem: number | null;
	allocable: boolean;
	consumptionBased: boolean;
	sortOrder: number;
};

/** § 2 BetrKV: item number, name, and whether the cost is split by consumption (HeizKV). */
const betrkvItems: readonly (readonly [number, string, boolean?])[] = [
	[1, 'Grundsteuer'],
	[2, 'Wasserversorgung'],
	[3, 'Entwässerung'],
	[4, 'Heizung', true],
	[5, 'Warmwasser', true],
	[6, 'Verbundene Heizungs- und Warmwasserversorgung', true],
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
	[17, 'Sonstige Betriebskosten']
];

export const defaultCategories: readonly DefaultCategory[] = betrkvItems.map(
	([item, name, consumptionBased]) => ({
		name,
		betrkvItem: item,
		allocable: true,
		consumptionBased: consumptionBased === true,
		sortOrder: item
	})
);

export const defaultLandlordCategories: readonly DefaultCategory[] = [
	{
		name: 'Verwaltungskosten (nicht umlagefähig)',
		betrkvItem: null,
		allocable: false,
		consumptionBased: false,
		sortOrder: 18
	},
	{
		name: 'Instandhaltung (nicht umlagefähig)',
		betrkvItem: null,
		allocable: false,
		consumptionBased: false,
		sortOrder: 19
	}
];

export type DefaultKey = {
	name: string;
	kind: AllocationKeyKind;
	meterKind: MeterKind | null;
	consumptionPercent: number | null;
};

export const defaultKeys: readonly DefaultKey[] = [
	{ name: 'Wohnfläche', kind: 'area', meterKind: null, consumptionPercent: null },
	{ name: 'Personen', kind: 'persons', meterKind: null, consumptionPercent: null },
	{ name: 'Einheiten', kind: 'units', meterKind: null, consumptionPercent: null },
	{ name: 'Heizung 70/30', kind: 'mixed', meterKind: 'heat', consumptionPercent: 70 },
	{ name: 'Warmwasser 70/30', kind: 'mixed', meterKind: 'hot_water', consumptionPercent: 70 },
	{ name: 'Beträge je Einheit', kind: 'direct', meterKind: null, consumptionPercent: null }
];

/** The key a seeded allocable category gets; everything not listed gets Wohnfläche. */
const defaultKeyByCategory: Record<string, string> = {
	Heizung: 'Heizung 70/30',
	'Verbundene Heizungs- und Warmwasserversorgung': 'Heizung 70/30',
	Warmwasser: 'Warmwasser 70/30',
	'Straßenreinigung und Müllbeseitigung': 'Personen'
};

function defaultKeyNameFor(categoryName: string): string {
	return defaultKeyByCategory[categoryName] ?? 'Wohnfläche';
}

/**
 * Seeds the standard categories and keys of the account, each allocable category with the key
 * the BetrKV suggests, unless that happened before. Once seeded, the landlord owns the list:
 * renamed, deleted or keyless entries stay as they are. One select when seeded; one batch
 * otherwise. Every page of the feature calls this first; returns whether this call seeded.
 */
export async function ensureDefaults(db: Database, accountId: string): Promise<boolean> {
	const [account] = await db
		.select({ seeded: accounts.operatingCostDefaultsSeeded })
		.from(accounts)
		.where(eq(accounts.id, accountId));
	if (!account || account.seeded) return false;

	const keys = defaultKeys.map((key) => ({
		id: crypto.randomUUID(),
		accountId,
		propertyId: null,
		...key
	}));
	const keyIdByName = new Map(keys.map((key) => [key.name, key.id]));
	const categories = [...defaultCategories, ...defaultLandlordCategories].map((category) => ({
		id: crypto.randomUUID(),
		accountId,
		...category,
		allocationKeyId: category.allocable
			? (keyIdByName.get(defaultKeyNameFor(category.name)) ?? null)
			: null
	}));

	await runBatch(db, [
		...chunk(keys, rowsPerStatement(allocationKeys)).map((rows) =>
			db.insert(allocationKeys).values(rows).onConflictDoNothing()
		),
		...chunk(categories, rowsPerStatement(costCategories)).map((rows) =>
			db.insert(costCategories).values(rows).onConflictDoNothing()
		),
		db.update(accounts).set({ operatingCostDefaultsSeeded: true }).where(eq(accounts.id, accountId))
	]);
	return true;
}
