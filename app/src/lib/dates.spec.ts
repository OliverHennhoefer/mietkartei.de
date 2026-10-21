import { describe, expect, it } from 'vitest';
import {
	addDays,
	addMonths,
	addMonthsToMonth,
	dayOf,
	formatDate,
	formatMonth,
	isIsoDate,
	lastOfMonth,
	today
} from './dates';

describe('validation', () => {
	it('accepts real dates only', () => {
		expect(isIsoDate('2026-02-28')).toBe(true);
		expect(isIsoDate('2024-02-29')).toBe(true);
		expect(isIsoDate('2026-02-29')).toBe(false);
		expect(isIsoDate('2026-13-01')).toBe(false);
		expect(isIsoDate('26-01-01')).toBe(false);
	});
});

describe('arithmetic', () => {
	it('adds days and months across boundaries', () => {
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
		expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
		expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
		expect(addMonthsToMonth('2026-11', 3)).toBe('2027-02');
		expect(addMonthsToMonth('2026-01', -1)).toBe('2025-12');
	});

	it('finds the last day of a month', () => {
		expect(lastOfMonth('2026-02')).toBe('2026-02-28');
		expect(lastOfMonth('2024-02')).toBe('2024-02-29');
		expect(lastOfMonth('2026-12')).toBe('2026-12-31');
	});
});

describe('formatting', () => {
	it('uses German formats', () => {
		expect(formatDate('2026-03-05')).toBe('05.03.2026');
		expect(() => formatDate('05.03.2026')).toThrow();
		expect(formatMonth('2026-03')).toBe('März 2026');
	});
});

describe('today', () => {
	it('returns today as an ISO date', () => {
		expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('takes the calendar day of a timestamp in Berlin, not in UTC', () => {
		// 00:30 on 15 March in Berlin (CET, UTC+1) is 23:30 on 14 March in UTC.
		expect(dayOf(new Date('2026-03-14T23:30:00Z'))).toBe('2026-03-15');
		// 00:30 on 1 July in Berlin (CEST, UTC+2) is 22:30 on 30 June in UTC.
		expect(dayOf(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01');
		expect(dayOf(new Date('2026-06-30T21:59:00Z'))).toBe('2026-06-30');
	});
});
