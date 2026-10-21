// Dates are ISO strings (YYYY-MM-DD) and months YYYY-MM; see PROTOTYPE.md "Conventions".
// All arithmetic is done in UTC so the result never depends on the server's time zone.

export type IsoDate = string;
export type IsoMonth = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
	const match = ISO_DATE.exec(value);
	if (!match) return false;
	const [, year, month, day] = match.map(Number);
	return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function isIsoMonth(value: string): boolean {
	const match = ISO_MONTH.exec(value);
	return !!match && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

function parts(date: IsoDate): [number, number, number] {
	const match = ISO_DATE.exec(date);
	if (!match) throw new Error(`Not an ISO date: ${date}`);
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function iso(year: number, month: number, day: number): IsoDate {
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function toUtc(date: IsoDate): Date {
	const [year, month, day] = parts(date);
	return new Date(Date.UTC(year, month - 1, day));
}

export function fromUtc(date: Date): IsoDate {
	return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const berlinDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' });

/** The calendar day of a timestamp in Germany, whatever time zone the server runs in. */
export function dayOf(date: Date): IsoDate {
	// sv-SE formats as YYYY-MM-DD.
	return berlinDate.format(date);
}

/** The current date in Germany, whatever time zone the server runs in. */
export function today(): IsoDate {
	return dayOf(new Date());
}

/** `31.12.2026` (also `31.12.26`, `1.2.2026`) → `2026-12-31`; undefined when not a date. */
export function parseGermanDate(value: string): IsoDate | undefined {
	const trimmed = value.trim();
	if (isIsoDate(trimmed)) return trimmed;
	const match = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(trimmed);
	if (!match) return undefined;
	const day = Number(match[1]);
	const month = Number(match[2]);
	const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
	const date = iso(year, month, day);
	return isIsoDate(date) ? date : undefined;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: IsoDate): number {
	return toUtc(date).getUTCDay();
}

/**
 * The n-th working day of the month, Monday to Friday. § 556b BGB makes the rent due on the
 * third working day; Saturday does not count (BGH VIII ZR 291/09). Public holidays are ignored.
 */
export function nthWorkingDay(month: IsoMonth, n: number): IsoDate {
	let date = firstOfMonth(month);
	let seen = 0;
	for (;;) {
		const day = weekday(date);
		if (day !== 0 && day !== 6) seen += 1;
		if (seen === n) return date;
		date = addDays(date, 1);
	}
}

export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: IsoDate, days: number): IsoDate {
	const utc = toUtc(date);
	utc.setUTCDate(utc.getUTCDate() + days);
	return fromUtc(utc);
}

/** Clamps the day to the target month: 2026-01-31 + 1 month = 2026-02-28. */
export function addMonths(date: IsoDate, months: number): IsoDate {
	const [year, month, day] = parts(date);
	const total = year * 12 + (month - 1) + months;
	const targetYear = Math.floor(total / 12);
	const targetMonth = (total % 12) + 1;
	return iso(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/** Days from `from` to `to`, negative when `to` is earlier. Same day = 0. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
	return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** Days in the closed range from `from` to `to`, both included. Same day = 1. */
export function daysInclusive(from: IsoDate, to: IsoDate): number {
	return Math.max(0, daysBetween(from, to) + 1);
}

export type DateRange = { start: IsoDate; end: IsoDate };

/** Days both closed ranges share. 0 when they do not overlap. */
export function overlapDays(a: DateRange, b: DateRange): number {
	const start = a.start > b.start ? a.start : b.start;
	const end = a.end < b.end ? a.end : b.end;
	return start > end ? 0 : daysInclusive(start, end);
}

/** The shared part of two closed ranges, or undefined when they do not overlap. */
export function overlap(a: DateRange, b: DateRange): DateRange | undefined {
	const start = a.start > b.start ? a.start : b.start;
	const end = a.end < b.end ? a.end : b.end;
	return start > end ? undefined : { start, end };
}

export function monthOf(date: IsoDate): IsoMonth {
	return date.slice(0, 7);
}

export function firstOfMonth(month: IsoMonth): IsoDate {
	return `${month}-01`;
}

export function lastOfMonth(month: IsoMonth): IsoDate {
	const [year, monthNumber] = month.split('-').map(Number);
	return iso(year, monthNumber, daysInMonth(year, monthNumber));
}

export function monthRange(month: IsoMonth): DateRange {
	return { start: firstOfMonth(month), end: lastOfMonth(month) };
}

export function addMonthsToMonth(month: IsoMonth, months: number): IsoMonth {
	return monthOf(addMonths(firstOfMonth(month), months));
}

/** All months from `from` to `to`, both included, in order. Empty when `to` is earlier. */
export function monthsInRange(from: IsoMonth, to: IsoMonth): IsoMonth[] {
	const months: IsoMonth[] = [];
	for (let month = from; month <= to; month = addMonthsToMonth(month, 1)) months.push(month);
	return months;
}

export function formatDate(date: IsoDate): string {
	const [year, month, day] = parts(date);
	return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

const monthNames = [
	'Januar',
	'Februar',
	'März',
	'April',
	'Mai',
	'Juni',
	'Juli',
	'August',
	'September',
	'Oktober',
	'November',
	'Dezember'
];

/** `2026-03` → `März 2026`. */
export function formatMonth(month: IsoMonth): string {
	const [year, monthNumber] = month.split('-').map(Number);
	return `${monthNames[monthNumber - 1]} ${year}`;
}

export function formatDateTime(date: Date): string {
	return new Intl.DateTimeFormat('de-DE', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'Europe/Berlin'
	}).format(date);
}
