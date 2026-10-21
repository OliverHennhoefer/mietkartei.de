import { describe, expect, it } from 'vitest';
import { dayOf, formatDate, today } from './dates';

describe('formatting', () => {
	it('uses the German format', () => {
		expect(formatDate('2026-03-05')).toBe('05.03.2026');
		expect(() => formatDate('05.03.2026')).toThrow();
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
