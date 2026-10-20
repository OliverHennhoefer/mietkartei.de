import { describe, expect, it } from 'vitest';
import {
	addDays,
	addMonths,
	daysBetween,
	daysInclusive,
	formatDate,
	formatMonth,
	isIsoDate,
	isIsoMonth,
	lastOfMonth,
	monthsInRange,
	nthWorkingDay,
	overlap,
	overlapDays,
	parseGermanDate,
	today
} from './dates';

describe('validation', () => {
	it('accepts real dates only', () => {
		expect(isIsoDate('2026-02-28')).toBe(true);
		expect(isIsoDate('2024-02-29')).toBe(true);
		expect(isIsoDate('2026-02-29')).toBe(false);
		expect(isIsoDate('2026-13-01')).toBe(false);
		expect(isIsoDate('26-01-01')).toBe(false);
		expect(isIsoMonth('2026-12')).toBe(true);
		expect(isIsoMonth('2026-00')).toBe(false);
	});
});

describe('arithmetic', () => {
	it('adds days and months across boundaries', () => {
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
		expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
		expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
	});

	it('counts days', () => {
		expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
		expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
		expect(daysInclusive('2026-01-01', '2026-12-31')).toBe(365);
		expect(daysInclusive('2024-01-01', '2024-12-31')).toBe(366);
		expect(daysInclusive('2026-02-02', '2026-02-01')).toBe(0);
	});

	it('computes overlaps of closed ranges', () => {
		const year = { start: '2026-01-01', end: '2026-12-31' };
		expect(overlapDays(year, { start: '2026-07-01', end: '2027-06-30' })).toBe(184);
		expect(overlapDays(year, { start: '2025-01-01', end: '2025-12-31' })).toBe(0);
		expect(overlap(year, { start: '2025-10-01', end: '2026-03-15' })).toEqual({
			start: '2026-01-01',
			end: '2026-03-15'
		});
		expect(overlap(year, { start: '2027-01-01', end: '2027-01-02' })).toBeUndefined();
	});

	it('lists months', () => {
		expect(monthsInRange('2026-11', '2027-02')).toEqual([
			'2026-11',
			'2026-12',
			'2027-01',
			'2027-02'
		]);
		expect(monthsInRange('2026-03', '2026-02')).toEqual([]);
		expect(lastOfMonth('2026-02')).toBe('2026-02-28');
	});
});

describe('formatting', () => {
	it('uses German formats', () => {
		expect(formatDate('2026-03-05')).toBe('05.03.2026');
		expect(formatMonth('2026-03')).toBe('März 2026');
	});
});

describe('working days and German dates', () => {
	it('finds the n-th working day, skipping Saturday and Sunday', () => {
		// October 2026 starts on a Thursday: 1 Thu, 2 Fri, 3 Sat, 4 Sun, 5 Mon.
		expect(nthWorkingDay('2026-10', 1)).toBe('2026-10-01');
		expect(nthWorkingDay('2026-10', 3)).toBe('2026-10-05');
		// August 2026 starts on a Saturday: 3 Mon, 4 Tue, 5 Wed.
		expect(nthWorkingDay('2026-08', 3)).toBe('2026-08-05');
	});

	it('parses German dates and leaves ISO dates alone', () => {
		expect(parseGermanDate('31.12.2026')).toBe('2026-12-31');
		expect(parseGermanDate('1.2.26')).toBe('2026-02-01');
		expect(parseGermanDate(' 05.03.2026 ')).toBe('2026-03-05');
		expect(parseGermanDate('2026-03-05')).toBe('2026-03-05');
		expect(parseGermanDate('31.02.2026')).toBeUndefined();
		expect(parseGermanDate('Buchungstag')).toBeUndefined();
	});

	it('returns today as an ISO date', () => {
		expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});
