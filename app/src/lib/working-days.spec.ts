import { describe, expect, it } from 'vitest';
import {
	easterSunday,
	isPublicHoliday,
	isWorkingDay,
	nthWorkingDay,
	publicHolidays
} from './working-days';

describe('easterSunday', () => {
	it('computes Easter Sunday of any year', () => {
		expect(easterSunday(2024)).toBe('2024-03-31');
		expect(easterSunday(2025)).toBe('2025-04-20');
		expect(easterSunday(2026)).toBe('2026-04-05');
		expect(easterSunday(2027)).toBe('2027-03-28');
		// The earliest and the latest possible dates.
		expect(easterSunday(2285)).toBe('2285-03-22');
		expect(easterSunday(2038)).toBe('2038-04-25');
	});
});

describe('publicHolidays', () => {
	it('lists the nine nationwide holidays in date order', () => {
		expect(publicHolidays(2026, null)).toEqual([
			'2026-01-01', // Neujahr
			'2026-04-03', // Karfreitag
			'2026-04-06', // Ostermontag
			'2026-05-01', // Tag der Arbeit
			'2026-05-14', // Christi Himmelfahrt
			'2026-05-25', // Pfingstmontag
			'2026-10-03', // Tag der Deutschen Einheit
			'2026-12-25',
			'2026-12-26'
		]);
	});

	it('moves the Easter holidays with Easter', () => {
		// Easter 2025 is on 20 April: Karfreitag 18 April, Himmelfahrt 29 May, Pfingstmontag 9 June.
		expect(isPublicHoliday('2025-04-18', null)).toBe(true);
		expect(isPublicHoliday('2025-04-21', null)).toBe(true);
		expect(isPublicHoliday('2025-05-29', null)).toBe(true);
		expect(isPublicHoliday('2025-06-09', null)).toBe(true);
		expect(isPublicHoliday('2025-04-20', null)).toBe(false);
	});

	it('leaves out holidays of single states', () => {
		// Heilige Drei Könige, Fronleichnam, Reformationstag.
		expect(isPublicHoliday('2026-01-06', null)).toBe(false);
		expect(isPublicHoliday('2026-06-04', null)).toBe(false);
		expect(isPublicHoliday('2026-10-31', null)).toBe(false);
	});
});

describe('isWorkingDay', () => {
	it('is Monday to Friday except public holidays', () => {
		expect(isWorkingDay('2026-10-02', null)).toBe(true);
		// Saturday 3 October 2026 is a holiday and a Saturday; Sunday never counts.
		expect(isWorkingDay('2026-10-03', null)).toBe(false);
		expect(isWorkingDay('2026-10-04', null)).toBe(false);
		// Friday 3 October 2025 is Tag der Deutschen Einheit.
		expect(isWorkingDay('2025-10-03', null)).toBe(false);
		expect(isWorkingDay('2026-04-06', null)).toBe(false);
	});
});

describe('nthWorkingDay', () => {
	it('finds the n-th working day, skipping Saturday and Sunday', () => {
		// October 2026 starts on a Thursday: 1 Thu, 2 Fri, 3 Sat, 4 Sun, 5 Mon.
		expect(nthWorkingDay('2026-10', 1, null)).toBe('2026-10-01');
		expect(nthWorkingDay('2026-10', 3, null)).toBe('2026-10-05');
		// August 2026 starts on a Saturday: 3 Mon, 4 Tue, 5 Wed.
		expect(nthWorkingDay('2026-08', 3, null)).toBe('2026-08-05');
	});

	it('skips public holidays', () => {
		// October 2025: Wed 1, Thu 2, Fri 3 is Tag der Deutschen Einheit, so Mon 6.
		expect(nthWorkingDay('2025-10', 3, null)).toBe('2025-10-06');
		// April 2026: Wed 1, Thu 2, Karfreitag 3, Ostermontag 6, so Tue 7.
		expect(nthWorkingDay('2026-04', 3, null)).toBe('2026-04-07');
		// January 2025: Neujahr on Wed 1, then Thu 2, Fri 3, Mon 6.
		expect(nthWorkingDay('2025-01', 1, null)).toBe('2025-01-02');
		expect(nthWorkingDay('2025-01', 3, null)).toBe('2025-01-06');
		// May 2025: Tag der Arbeit on Thu 1, then Fri 2, Mon 5, Tue 6.
		expect(nthWorkingDay('2025-05', 3, null)).toBe('2025-05-06');
		// December 2026: Thu 24 is the 18th working day; Christmas falls on Friday and Saturday,
		// so the 19th is Mon 28.
		expect(nthWorkingDay('2026-12', 18, null)).toBe('2026-12-24');
		expect(nthWorkingDay('2026-12', 19, null)).toBe('2026-12-28');
	});

	it('stops at the last working day of a month with fewer working days', () => {
		// May 2026 has 18 working days: Tag der Arbeit (Fri 1), Christi Himmelfahrt (Thu 14) and
		// Pfingstmontag (Mon 25) fall on weekdays. The 18th is Fri 29.
		expect(nthWorkingDay('2026-05', 18, null)).toBe('2026-05-29');
		expect(nthWorkingDay('2026-05', 19, null)).toBe('2026-05-29');
		expect(nthWorkingDay('2026-05', 20, null)).toBe('2026-05-29');
	});
});

describe('holidays of a Bundesland', () => {
	it('adds the statewide holidays of the state', () => {
		expect(publicHolidays(2026, 'BY')).toEqual([
			'2026-01-01',
			'2026-01-06', // Heilige Drei Könige
			'2026-04-03',
			'2026-04-06',
			'2026-05-01',
			'2026-05-14',
			'2026-05-25',
			'2026-06-04', // Fronleichnam
			'2026-10-03',
			'2026-11-01', // Allerheiligen
			'2026-12-25',
			'2026-12-26'
		]);
		expect(isPublicHoliday('2026-08-15', 'SL')).toBe(true);
		// Mariä Himmelfahrt holds only in the Catholic municipalities of Bavaria.
		expect(isPublicHoliday('2026-08-15', 'BY')).toBe(false);
		expect(isPublicHoliday('2026-09-20', 'TH')).toBe(true);
		expect(isPublicHoliday('2026-10-31', 'NI')).toBe(true);
		expect(isPublicHoliday('2026-10-31', 'NW')).toBe(false);
	});

	it('finds Buß- und Bettag in Saxony on the Wednesday before 23 November', () => {
		expect(isPublicHoliday('2025-11-19', 'SN')).toBe(true);
		expect(isPublicHoliday('2026-11-18', 'SN')).toBe(true);
		expect(isPublicHoliday('2026-11-18', 'ST')).toBe(false);
	});

	it('counts a holiday from the year its law introduced it', () => {
		expect(isPublicHoliday('2018-03-08', 'BE')).toBe(false);
		expect(isPublicHoliday('2019-03-08', 'BE')).toBe(true);
		expect(isPublicHoliday('2022-03-08', 'MV')).toBe(false);
		expect(isPublicHoliday('2023-03-08', 'MV')).toBe(true);
		expect(isPublicHoliday('2017-10-31', 'HH')).toBe(true); // 500 Jahre Reformation, everywhere
		expect(isPublicHoliday('2017-10-31', null)).toBe(true);
		expect(isPublicHoliday('2016-10-31', 'HH')).toBe(false);
		expect(isPublicHoliday('2025-05-08', 'BE')).toBe(true);
		expect(isPublicHoliday('2026-05-08', 'BE')).toBe(false);
	});

	it('moves the rent due day past a state holiday', () => {
		// January 2026: Neujahr Thu 1, Fri 2, Mon 5, Tue 6 is the third working day; in Bavaria
		// Heilige Drei Könige on Tue 6 moves it to Wed 7.
		expect(nthWorkingDay('2026-01', 3, null)).toBe('2026-01-06');
		expect(nthWorkingDay('2026-01', 3, 'BY')).toBe('2026-01-07');
	});
});
