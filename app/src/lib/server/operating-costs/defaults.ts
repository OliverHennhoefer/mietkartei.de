import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db';
import { chunk, chunkIds, rowsPerStatement, runBatch } from '../db/batch';
import {
	allocationKeys,
	costCategories,
	type AllocationKeyKind,
	type MeterKind
} from '../db/schema';

// The categories and keys every account starts with: the 17 items of § 2 BetrKV, two landlord
// categories that are never allocated, and the keys the BetrKV and the HeizKV name. Seeded on
// first use of any operating costs page; `onConflictDoNothing` on the unique (account, name)
// indexes keeps the call idempotent and harmless when two requests race.

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

/** The key an allocable category without one gets; everything not listed gets Wohnfläche. */
const defaultKeyByCategory: Record<string, string> = {
	Heizung: 'Heizung 70/30',
	'Verbundene Heizungs- und Warmwasserversorgung': 'Heizung 70/30',
	Warmwasser: 'Warmwasser 70/30',
	'Straßenreinigung und Müllbeseitigung': 'Personen'
};

export function defaultKeyNameFor(categoryName: string): string {
	return defaultKeyByCategory[categoryName] ?? 'Wohnfläche';
}

export type EnsureDefaultsResult = {
	categoriesInserted: number;
	keysInserted: number;
	categoriesDefaulted: number;
};

/**
 * Inserts the missing standard categories and keys of the account and gives every allocable
 * category without a default key the one the BetrKV suggests. Two selects when everything
 * exists; one batch otherwise. Every page of the feature calls this first.
 */
export async function ensureDefaults(
	db: Database,
	accountId: string
): Promise<EnsureDefaultsResult> {
	const existingCategories = await db
		.select({
			id: costCategories.id,
			name: costCategories.name,
			allocable: costCategories.allocable,
			allocationKeyId: costCategories.allocationKeyId
		})
		.from(costCategories)
		.where(eq(costCategories.accountId, accountId));
	const existingKeys = await db
		.select({ id: allocationKeys.id, name: allocationKeys.name })
		.from(allocationKeys)
		.where(eq(allocationKeys.accountId, accountId));

	const categoryNames = new Set(existingCategories.map((row) => row.name));
	const missingCategories = [...defaultCategories, ...defaultLandlordCategories]
		.filter((category) => !categoryNames.has(category.name))
		.map((category) => ({ id: crypto.randomUUID(), accountId, ...category }));

	const keyIdByName = new Map(existingKeys.map((row) => [row.name, row.id]));
	const missingKeys = defaultKeys
		.filter((key) => !keyIdByName.has(key.name))
		.map((key) => ({ id: crypto.randomUUID(), accountId, propertyId: null, ...key }));
	for (const key of missingKeys) keyIdByName.set(key.name, key.id);

	// Categories that need a default key, grouped by the key, so it is one update per key.
	const categoryIdsByKey = new Map<string, string[]>();
	const needingKey = [
		...existingCategories.filter((row) => row.allocable && row.allocationKeyId === null),
		...missingCategories.filter((row) => row.allocable)
	];
	for (const category of needingKey) {
		const keyId = keyIdByName.get(defaultKeyNameFor(category.name));
		if (!keyId) continue;
		categoryIdsByKey.set(keyId, [...(categoryIdsByKey.get(keyId) ?? []), category.id]);
	}

	const statements = [
		...chunk(missingCategories, rowsPerStatement(costCategories)).map((rows) =>
			db.insert(costCategories).values(rows).onConflictDoNothing()
		),
		...chunk(missingKeys, rowsPerStatement(allocationKeys)).map((rows) =>
			db.insert(allocationKeys).values(rows).onConflictDoNothing()
		),
		...[...categoryIdsByKey].flatMap(([keyId, categoryIds]) =>
			chunkIds(categoryIds).map((ids) =>
				db
					.update(costCategories)
					.set({ allocationKeyId: keyId })
					.where(
						and(
							eq(costCategories.accountId, accountId),
							isNull(costCategories.allocationKeyId),
							inArray(costCategories.id, ids)
						)
					)
			)
		)
	];
	await runBatch(db, statements);
	return {
		categoriesInserted: missingCategories.length,
		keysInserted: missingKeys.length,
		categoriesDefaulted: needingKey.length
	};
}
