import { describe, expect, it } from 'vitest';
import {
	insuranceYear,
	insuranceYearsFor,
	nextCancellation,
	nextRenewal,
	noticeDeadline,
	premiumFor
} from './insurance';

describe('insuranceYear and nextRenewal', () => {
	it('runs from the renewal date to the day before the next one', () => {
		expect(insuranceYear('2026-04-01', 0)).toEqual({ start: '2026-04-01', end: '2027-03-31' });
		expect(insuranceYear('2024-01-01', 2)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
	});

	it('finds the next renewal after today, or the stored date while it lies ahead', () => {
		expect(nextRenewal('2020-01-01', '2026-10-23')).toBe('2027-01-01');
		expect(nextRenewal('2020-10-23', '2026-10-23')).toBe('2027-10-23');
		expect(nextRenewal('2027-03-01', '2026-10-23')).toBe('2027-03-01');
	});
});

describe('noticeDeadline and nextCancellation', () => {
	it('ends the day before the notice period starts', () => {
		// Renewal on 1 January, three months: the cancellation must arrive by 30 September.
		expect(noticeDeadline('2027-01-01', 3)).toBe('2026-09-30');
		expect(noticeDeadline('2027-04-01', 1)).toBe('2027-02-28');
	});

	it('moves on a year once the deadline for the next renewal has passed', () => {
		expect(nextCancellation('2020-01-01', 3, '2026-09-30')).toEqual({
			renewal: '2027-01-01',
			deadline: '2026-09-30'
		});
		expect(nextCancellation('2020-01-01', 3, '2026-10-23')).toEqual({
			renewal: '2028-01-01',
			deadline: '2027-09-30'
		});
	});
});

describe('insuranceYearsFor and premiumFor', () => {
	it('lists the insurance years overlapping the calendar years', () => {
		expect(insuranceYearsFor({ renewalDate: '2024-04-01', endDate: null }, [2025, 2026])).toEqual([
			{ start: '2024-04-01', end: '2025-03-31', fullEnd: '2025-03-31' },
			{ start: '2025-04-01', end: '2026-03-31', fullEnd: '2026-03-31' },
			{ start: '2026-04-01', end: '2027-03-31', fullEnd: '2027-03-31' }
		]);
		expect(insuranceYearsFor({ renewalDate: '2026-01-01', endDate: null }, [2025, 2026])).toEqual([
			{ start: '2026-01-01', end: '2026-12-31', fullEnd: '2026-12-31' }
		]);
		expect(insuranceYearsFor({ renewalDate: '2026-01-01', endDate: null }, [])).toEqual([]);
	});

	it('cuts the last year at the end of cover and prorates its premium', () => {
		const years = insuranceYearsFor(
			{ renewalDate: '2025-01-01', endDate: '2026-06-30' },
			[2025, 2026, 2027]
		);
		expect(years).toEqual([
			{ start: '2025-01-01', end: '2025-12-31', fullEnd: '2025-12-31' },
			{ start: '2026-01-01', end: '2026-06-30', fullEnd: '2026-12-31' }
		]);
		expect(premiumFor(365_00, years[0])).toBe(365_00);
		// 181 of 365 days.
		expect(premiumFor(365_00, years[1])).toBe(181_00);
	});
});
