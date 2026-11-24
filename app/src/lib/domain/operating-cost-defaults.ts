import type { AllocationKeyKind, MeterKind } from '../server/db/schema';

// The categories and keys every account starts with: the 17 items of § 2 BetrKV, two landlord
// categories that are never allocated, and the keys the BetrKV and the HeizKV name. Pure, so the
// free statement tool on mietkartei.de offers the same list; server/operating-costs/defaults.ts
// seeds them into an account.

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

/**
 * The key a seeded category gets; everything not listed gets Wohnfläche, the fallback of § 556a
 * (1) BGB. The landlord categories get it too, although nothing of them is allocated: a Beleg
 * needs a key, and asking for one on the Verwaltervergütung would only be in the way. A combined heating and hot water system gets none: § 9 HeizKV splits its
 * costs into heating and hot water first, and that split comes from the meter service.
 */
const defaultKeyByCategory: Record<string, string | null> = {
	Heizung: 'Heizung 70/30',
	Warmwasser: 'Warmwasser 70/30',
	'Verbundene Heizungs- und Warmwasserversorgung': null
};

export function defaultKeyNameFor(categoryName: string): string | null {
	const name = defaultKeyByCategory[categoryName];
	return name === undefined ? 'Wohnfläche' : name;
}
