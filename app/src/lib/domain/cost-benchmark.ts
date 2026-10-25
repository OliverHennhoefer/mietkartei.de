import { daysInclusive, overlapDays, type DateRange, type IsoDate } from '../dates';
import type { UnitKind } from '../units';

// Nebenkosten-Vergleich: the operating costs of a year per m² and month, by the items of § 2
// BetrKV, set against the Betriebskostenspiegel of the Deutscher Mieterbund. A cost item counts
// with the days of its period that fall into the year, like in the statement. Pure: the server
// module loads the rows.

/** Betriebskostenspiegel für Deutschland, Abrechnungsjahr 2024, published December 2025. */
export const benchmarkSource = {
	name: 'Betriebskostenspiegel des Deutschen Mieterbundes',
	year: 2024,
	url: 'https://mieterbund.de/app/uploads/2025/12/20251218-3.pdf'
} as const;

export type BenchmarkGroup = {
	key: string;
	label: string;
	/** The § 2 BetrKV items it covers. */
	items: readonly number[];
	/** The Mieterbund value in cents per m² and month. */
	reference: number;
};

export const benchmarkGroups: readonly BenchmarkGroup[] = [
	{ key: 'heating', label: 'Heizung und Warmwasser', items: [4, 5, 6], reference: 132 },
	{ key: 'water', label: 'Wasser und Abwasser', items: [2, 3], reference: 29 },
	{ key: 'insurance', label: 'Versicherungen', items: [13], reference: 31 },
	// The Mieterbund gives 0,21 € for a Hauswart next to separate cleaning and garden costs,
	// which is how the categories here are kept.
	{ key: 'caretaker', label: 'Hauswart', items: [14], reference: 21 },
	{ key: 'cleaning', label: 'Gebäudereinigung', items: [9], reference: 21 },
	{ key: 'elevator', label: 'Aufzug', items: [7], reference: 20 },
	{ key: 'waste', label: 'Straßenreinigung und Müll', items: [8], reference: 20 },
	{ key: 'propertyTax', label: 'Grundsteuer', items: [1], reference: 18 },
	{ key: 'garden', label: 'Gartenpflege', items: [10], reference: 15 },
	{ key: 'antenna', label: 'Antenne und Kabel', items: [15], reference: 7 },
	{ key: 'lighting', label: 'Beleuchtung', items: [11], reference: 6 },
	{ key: 'chimney', label: 'Schornsteinreinigung', items: [12], reference: 4 },
	{ key: 'other', label: 'Sonstige', items: [16, 17], reference: 7 }
];

/** The Mieterbund total over every kind of cost, in cents per m² and month. */
export const referenceTotal = 267;

export type BenchmarkInput = {
	properties: readonly { id: string; name: string }[];
	units: readonly { propertyId: string; kind: UnitKind; floorArea: number | null }[];
	costItems: readonly {
		propertyId: string;
		betrkvItem: number;
		amount: number;
		periodStart: IsoDate;
		periodEnd: IsoDate;
	}[];
};

export type BenchmarkRow = BenchmarkGroup & {
	/** Cents in the year. */
	amount: number;
	/** Cents per m² and month; null without floor area. */
	perSqm: number | null;
};

export type PropertyBenchmark = {
	id: string;
	name: string;
	area: number;
	amount: number;
	perSqm: number | null;
};

export type Benchmark = {
	/** The floor area of the properties with costs in the year. */
	area: number;
	amount: number;
	perSqm: number | null;
	/** Every group, also those without costs, in the order of the Mieterbund. */
	rows: BenchmarkRow[];
	properties: PropertyBenchmark[];
	/**
	 * Properties with costs in the year but no floor area (or a unit without one), left out of the
	 * figures per m².
	 */
	withoutArea: string[];
};

export function costBenchmark(
	input: BenchmarkInput,
	options: { year: number; propertyId: string | null }
): Benchmark {
	const range: DateRange = { start: `${options.year}-01-01`, end: `${options.year}-12-31` };
	const inView = input.properties.filter(
		(property) => !options.propertyId || property.id === options.propertyId
	);

	// A property with a flat or a shop of unknown area has no area at all: dividing by the units
	// that have one would overstate the costs. A parking space needs none.
	const areaOf = new Map<string, number>();
	const incomplete = new Set<string>();
	for (const unit of input.units) {
		if (!unit.floorArea && unit.kind !== 'parking') incomplete.add(unit.propertyId);
		areaOf.set(unit.propertyId, (areaOf.get(unit.propertyId) ?? 0) + (unit.floorArea ?? 0));
	}
	for (const propertyId of incomplete) areaOf.set(propertyId, 0);

	/** Cents in the year per property and § 2 item. */
	const amounts = new Map<string, Map<number, number>>();
	for (const item of input.costItems) {
		const days = overlapDays({ start: item.periodStart, end: item.periodEnd }, range);
		if (days === 0) continue;
		const share = Math.round(
			(item.amount * days) / daysInclusive(item.periodStart, item.periodEnd)
		);
		const byItem = amounts.get(item.propertyId) ?? new Map<number, number>();
		byItem.set(item.betrkvItem, (byItem.get(item.betrkvItem) ?? 0) + share);
		amounts.set(item.propertyId, byItem);
	}

	const perMonth = (cents: number, area: number) => (area > 0 ? cents / area / 12 : null);
	const sum = (byItem: Map<number, number> | undefined, items: readonly number[]) =>
		items.reduce((total, item) => total + (byItem?.get(item) ?? 0), 0);
	const allItems = benchmarkGroups.flatMap((group) => group.items);

	const properties: PropertyBenchmark[] = [];
	const withoutArea: string[] = [];
	for (const property of inView) {
		const byItem = amounts.get(property.id);
		if (!byItem) continue;
		const area = areaOf.get(property.id) ?? 0;
		const amount = sum(byItem, allItems);
		if (area <= 0) withoutArea.push(property.name);
		properties.push({
			id: property.id,
			name: property.name,
			area,
			amount,
			perSqm: perMonth(amount, area)
		});
	}

	// The figures per m² over the properties with an area, so a missing one does not dilute them.
	const counted = properties.filter((row) => row.area > 0);
	const area = counted.reduce((total, row) => total + row.area, 0);
	const rows = benchmarkGroups.map((group) => {
		const amount = counted.reduce((total, row) => total + sum(amounts.get(row.id), group.items), 0);
		return { ...group, amount, perSqm: perMonth(amount, area) };
	});
	const amount = counted.reduce((total, row) => total + row.amount, 0);
	return { area, amount, perSqm: perMonth(amount, area), rows, properties, withoutArea };
}
