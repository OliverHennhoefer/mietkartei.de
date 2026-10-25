import { and, eq, isNotNull } from 'drizzle-orm';
import { costBenchmark, type Benchmark } from '../domain/cost-benchmark';
import type { Database } from './db';
import { costCategories, costItems, properties, units } from './db/schema';

// Loads the cost items of the Nebenkosten-Vergleich: the allocable ones in an allocable category of
// § 2 BetrKV, as the statement counts them, with the floor area of every property.

export type BenchmarkPage = Benchmark & {
	/** The years with cost items, newest first. */
	years: number[];
	propertyOptions: { id: string; name: string }[];
};

export async function loadCostBenchmark(
	db: Database,
	accountId: string,
	options: { year: number | null; propertyId: string | null; currentYear: number }
): Promise<BenchmarkPage & { year: number }> {
	const [propertyRows, unitRows, itemRows] = await Promise.all([
		db
			.select({ id: properties.id, name: properties.name })
			.from(properties)
			.where(eq(properties.accountId, accountId))
			.orderBy(properties.name),
		db
			.select({ propertyId: units.propertyId, kind: units.kind, floorArea: units.floorArea })
			.from(units)
			.where(eq(units.accountId, accountId)),
		db
			.select({
				propertyId: costItems.propertyId,
				betrkvItem: costCategories.betrkvItem,
				amount: costItems.amount,
				periodStart: costItems.periodStart,
				periodEnd: costItems.periodEnd
			})
			.from(costItems)
			.innerJoin(costCategories, eq(costCategories.id, costItems.categoryId))
			.where(
				and(
					eq(costItems.accountId, accountId),
					eq(costItems.allocable, true),
					eq(costCategories.allocable, true),
					isNotNull(costCategories.betrkvItem)
				)
			)
	]);
	const items = itemRows.flatMap((row) =>
		row.betrkvItem === null ? [] : [{ ...row, betrkvItem: row.betrkvItem }]
	);

	const covered = new Set<number>();
	for (const item of items) {
		const last = Math.min(Number(item.periodEnd.slice(0, 4)), options.currentYear);
		for (let year = Number(item.periodStart.slice(0, 4)); year <= last; year++) covered.add(year);
	}
	const years = [...covered].sort((a, b) => b - a);
	// By default the latest year that is over, as the Mieterbund compares whole years.
	const year =
		options.year ??
		years.find((candidate) => candidate < options.currentYear) ??
		options.currentYear;

	const result = costBenchmark(
		{ properties: propertyRows, units: unitRows, costItems: items },
		{ year, propertyId: options.propertyId }
	);
	return {
		...result,
		year,
		years,
		propertyOptions: propertyRows
	};
}
