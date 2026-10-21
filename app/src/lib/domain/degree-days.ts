import {
	daysInMonth,
	monthOf,
	monthRange,
	monthsInRange,
	overlapDays,
	type DateRange
} from '../dates';

// Gradtagszahlen: how the heating demand of a year spreads over its months. When a tenant changes
// without a Zwischenablesung, the heat consumption of the year is split between the old and the
// new tenant by these shares (§ 9b HeizKV allows the method).

/** Monthly shares in per mille, January to December; they add up to 1000. */
export const degreeDayShares: readonly number[] = [
	170, 150, 130, 80, 40, 13, 13, 14, 30, 80, 120, 160
];

/**
 * The degree days of a closed date range: every month's share, prorated by the days of the month
 * that lie in the range. A full calendar year gives 1000; a leap year too.
 */
export function degreeDays(range: DateRange): number {
	if (range.start > range.end) return 0;
	let sum = 0;
	for (const month of monthsInRange(monthOf(range.start), monthOf(range.end))) {
		const [year, monthNumber] = month.split('-').map(Number);
		const days = overlapDays(range, monthRange(month));
		sum += (degreeDayShares[monthNumber - 1] * days) / daysInMonth(year, monthNumber);
	}
	return sum;
}
