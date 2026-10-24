import type { IsoDate } from '#lib/dates.ts';

/** The year of ?jahr=, by default the one before `date`'s; never one after the current year. */
export function taxYearOf(value: string | null, date: IsoDate): number {
	const current = Number(date.slice(0, 4));
	const year = Number(value);
	return value && Number.isInteger(year) && year >= 1900 && year <= current ? year : current - 1;
}
