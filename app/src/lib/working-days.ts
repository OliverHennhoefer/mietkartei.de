import { addDays, firstOfMonth, lastOfMonth, weekday, type IsoDate, type IsoMonth } from './dates';

// Public holidays and working days: the nine nationwide holidays plus the statewide ones of the
// Bundesland of the property. Holidays of single municipalities are left out: Mariä Himmelfahrt
// in the Catholic parts of Bavaria, Fronleichnam in parts of Saxony and Thuringia, the Augsburger
// Friedensfest. Without a Bundesland only the nationwide holidays count.

/** The 16 Länder by their ISO 3166-2 code. */
export const germanStates = [
	'BW',
	'BY',
	'BE',
	'BB',
	'HB',
	'HH',
	'HE',
	'MV',
	'NI',
	'NW',
	'RP',
	'SL',
	'SN',
	'ST',
	'SH',
	'TH'
] as const;
export type GermanState = (typeof germanStates)[number];

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

/**
 * The public holidays of the year in date order: the nationwide ones, and with a Bundesland its
 * statewide ones too, each from the year its law introduced it.
 */
export function publicHolidays(year: number, state: GermanState | null): IsoDate[] {
	const easter = easterSunday(year);
	const fixed = (monthDay: string) => `${String(year).padStart(4, '0')}-${monthDay}`;
	const holidays = [
		fixed('01-01'), // Neujahr
		addDays(easter, -2), // Karfreitag
		addDays(easter, 1), // Ostermontag
		fixed('05-01'), // Tag der Arbeit
		addDays(easter, 39), // Christi Himmelfahrt
		addDays(easter, 50), // Pfingstmontag
		fixed('10-03'), // Tag der Deutschen Einheit
		fixed('12-25'), // 1. Weihnachtstag
		fixed('12-26') // 2. Weihnachtstag
	];
	// 500 Jahre Reformation: a holiday in every state once.
	if (year === 2017) holidays.push(fixed('10-31'));
	if (state) holidays.push(...stateHolidays(year, state, easter));
	return [...new Set(holidays)].sort();
}

function stateHolidays(year: number, state: GermanState, easter: IsoDate): IsoDate[] {
	const fixed = (monthDay: string) => `${String(year).padStart(4, '0')}-${monthDay}`;
	const among = (...states: GermanState[]) => states.includes(state);
	const holidays: IsoDate[] = [];
	if (among('BW', 'BY', 'ST')) holidays.push(fixed('01-06')); // Heilige Drei Könige
	if ((state === 'BE' && year >= 2019) || (state === 'MV' && year >= 2023)) {
		holidays.push(fixed('03-08')); // Internationaler Frauentag
	}
	if (state === 'BE' && (year === 2020 || year === 2025)) {
		holidays.push(fixed('05-08')); // Tag der Befreiung, 75 and 80 years
	}
	if (among('BW', 'BY', 'HE', 'NW', 'RP', 'SL')) holidays.push(addDays(easter, 60)); // Fronleichnam
	if (state === 'SL') holidays.push(fixed('08-15')); // Mariä Himmelfahrt
	if (state === 'TH' && year >= 2019) holidays.push(fixed('09-20')); // Weltkindertag
	if (among('BB', 'MV', 'SN', 'ST', 'TH') || (among('HB', 'HH', 'NI', 'SH') && year >= 2018)) {
		holidays.push(fixed('10-31')); // Reformationstag
	}
	if (among('BW', 'BY', 'NW', 'RP', 'SL')) holidays.push(fixed('11-01')); // Allerheiligen
	if (state === 'SN') {
		// Buß- und Bettag: the Wednesday before 23 November, so between 16 and 22 November.
		let date = fixed('11-22');
		while (weekday(date) !== 3) date = addDays(date, -1);
		holidays.push(date);
	}
	return holidays;
}

const holidaysByYear = new Map<string, Set<IsoDate>>();

export function isPublicHoliday(date: IsoDate, state: GermanState | null): boolean {
	const year = Number(date.slice(0, 4));
	const key = `${year}-${state ?? ''}`;
	let holidays = holidaysByYear.get(key);
	if (!holidays) {
		holidays = new Set(publicHolidays(year, state));
		holidaysByYear.set(key, holidays);
	}
	return holidays.has(date);
}

/** Monday to Friday and not a public holiday (of the Bundesland, when given). */
export function isWorkingDay(date: IsoDate, state: GermanState | null): boolean {
	const day = weekday(date);
	return day !== 0 && day !== 6 && !isPublicHoliday(date, state);
}

/**
 * The n-th working day of the month. § 556b BGB makes the rent due on the third working day;
 * Saturday does not count (BGH VIII ZR 291/09), and neither does a public holiday. A month with
 * fewer than n working days (May 2026 has only 18) yields its last working day, so the due date
 * never runs into the next month; n below 1 counts as the first working day.
 */
export function nthWorkingDay(month: IsoMonth, n: number, state: GermanState | null): IsoDate {
	const last = lastOfMonth(month);
	const wanted = Math.max(1, n);
	let found = firstOfMonth(month);
	let seen = 0;
	for (let date = found; date <= last && seen < wanted; date = addDays(date, 1)) {
		if (isWorkingDay(date, state)) {
			found = date;
			seen += 1;
		}
	}
	return found;
}
