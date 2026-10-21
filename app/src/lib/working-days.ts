import { addDays, firstOfMonth, lastOfMonth, weekday, type IsoDate, type IsoMonth } from './dates';

// Public holidays and working days. Only the nine holidays that apply in every German state are
// modelled; the state holidays (Heilige Drei Könige, Fronleichnam, Reformationstag …) would come
// from the Bundesland of the property and are not known yet.

/** Easter Sunday of the year in the Gregorian calendar (anonymous Gregorian algorithm). */
export function easterSunday(year: number): IsoDate {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The nationwide public holidays of the year, in date order. */
export function publicHolidays(year: number): IsoDate[] {
	const easter = easterSunday(year);
	const fixed = (monthDay: string) => `${String(year).padStart(4, '0')}-${monthDay}`;
	return [
		fixed('01-01'), // Neujahr
		addDays(easter, -2), // Karfreitag
		addDays(easter, 1), // Ostermontag
		fixed('05-01'), // Tag der Arbeit
		addDays(easter, 39), // Christi Himmelfahrt
		addDays(easter, 50), // Pfingstmontag
		fixed('10-03'), // Tag der Deutschen Einheit
		fixed('12-25'), // 1. Weihnachtstag
		fixed('12-26') // 2. Weihnachtstag
	].sort();
}

const holidaysByYear = new Map<number, Set<IsoDate>>();

export function isPublicHoliday(date: IsoDate): boolean {
	const year = Number(date.slice(0, 4));
	let holidays = holidaysByYear.get(year);
	if (!holidays) {
		holidays = new Set(publicHolidays(year));
		holidaysByYear.set(year, holidays);
	}
	return holidays.has(date);
}

/** Monday to Friday and not a public holiday. */
export function isWorkingDay(date: IsoDate): boolean {
	const day = weekday(date);
	return day !== 0 && day !== 6 && !isPublicHoliday(date);
}

/**
 * The n-th working day of the month. § 556b BGB makes the rent due on the third working day;
 * Saturday does not count (BGH VIII ZR 291/09), and neither does a public holiday. A month with
 * fewer than n working days (May 2026 has only 18) yields its last working day, so the due date
 * never runs into the next month; n below 1 counts as the first working day.
 */
export function nthWorkingDay(month: IsoMonth, n: number): IsoDate {
	const last = lastOfMonth(month);
	const wanted = Math.max(1, n);
	let found = firstOfMonth(month);
	let seen = 0;
	for (let date = found; date <= last && seen < wanted; date = addDays(date, 1)) {
		if (isWorkingDay(date)) {
			found = date;
			seen += 1;
		}
	}
	return found;
}
