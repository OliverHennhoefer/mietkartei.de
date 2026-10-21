import { co2KgFromKwh } from './co2';

// Pure helpers of the operating costs setup: defaults a form fills in before the user types, and
// the small sums the pages show. Everything that touches the database lives in
// src/lib/server/operating-costs/.

export type MeterKindName = 'cold_water' | 'hot_water' | 'heat' | 'gas' | 'electricity';

/** The unit of measure a new meter of the kind usually has: kWh for energy, m³ for water. */
export function defaultMeterUnit(kind: MeterKindName): string {
	return kind === 'cold_water' || kind === 'hot_water' ? 'm³' : 'kWh';
}

/** The calendar year of an ISO date as a number. */
export function yearOf(date: string): number {
	return Number(date.slice(0, 4));
}

/** The first and last day of a calendar year. */
export function calendarYear(year: number): { periodStart: string; periodEnd: string } {
	return { periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` };
}

/**
 * The period a new cost item covers before the user changes it: the calendar year of the invoice
 * date, or the last calendar year when the invoice has no date yet.
 */
export function defaultCostPeriod(
	invoiceDate: string | null,
	today: string
): { periodStart: string; periodEnd: string } {
	return calendarYear(invoiceDate ? yearOf(invoiceDate) : yearOf(today) - 1);
}

/**
 * The years offered by the year filter of the cost item list: every year that has an item plus
 * the current one, newest first, without duplicates.
 */
export function filterYears(yearsWithItems: readonly number[], currentYear: number): number[] {
	return [...new Set([...yearsWithItems, currentYear])].sort((a, b) => b - a);
}

/** The sum of the per-unit amounts of a direct key and how far it is from the item amount. */
export function unitAmountsSummary(
	amounts: readonly number[],
	itemAmount: number
): { sum: number; difference: number } {
	const sum = amounts.reduce((total, amount) => total + amount, 0);
	return { sum, difference: itemAmount - sum };
}

/** The value of the circle select that means "take the category's default". */
export const CIRCLE_FROM_CATEGORY = 'default';

/** What the cost item form sends: key and circle may be left to the category's defaults. */
export type CostItemChoice = {
	/** Null: the default key of the category. */
	allocationKeyId: string | null;
	/** Null: no circle (all units of the property), unless `circleFromCategory`. */
	billingCircleId: string | null;
	circleFromCategory: boolean;
	fuel: string | null;
	fuelKwh: number | null;
	co2Kg: number | null;
};

export type CategoryDefaults = {
	allocationKeyId: string | null;
	billingCircleId: string | null;
};

/**
 * Fills in what the form left to the category: the key when none was chosen, the circle when
 * "Standard der Kostenart" was chosen, and the CO₂ kg from the kWh when the invoice did not
 * state them. Undefined when neither the form nor the category names a key.
 */
export function applyCategoryDefaults<T extends CostItemChoice>(
	choice: T,
	category: CategoryDefaults
):
	| (Omit<T, 'allocationKeyId' | 'billingCircleId'> &
			CategoryDefaults & { allocationKeyId: string })
	| undefined {
	const allocationKeyId = choice.allocationKeyId ?? category.allocationKeyId;
	if (!allocationKeyId) return undefined;
	const billingCircleId = choice.circleFromCategory
		? category.billingCircleId
		: choice.billingCircleId;
	const co2Kg = choice.co2Kg ?? co2KgFromKwh(choice.fuel, choice.fuelKwh);
	return { ...choice, allocationKeyId, billingCircleId, co2Kg };
}

/** The sum of the amounts of each category, in the order the categories first appear. */
export function sumByCategory<T extends { categoryName: string; amount: number }>(
	items: readonly T[]
): { categoryName: string; total: number; count: number }[] {
	const totals = new Map<string, { categoryName: string; total: number; count: number }>();
	for (const item of items) {
		const entry = totals.get(item.categoryName) ?? {
			categoryName: item.categoryName,
			total: 0,
			count: 0
		};
		entry.total += item.amount;
		entry.count += 1;
		totals.set(item.categoryName, entry);
	}
	return [...totals.values()];
}
