import { describe, expect, it } from 'vitest';
import {
	fullYears,
	leaseEndDeadlines,
	noticePeriodMonths,
	proposedEndDate,
	type LeaseEndInput
} from './lease-end';

// Working days in March 2026: Mon 2nd = 1st, Tue 3rd = 2nd, Wed 4th = 3rd working day.
const tenant: LeaseEndInput = {
	kind: 'residential',
	startDate: '2024-01-01',
	terminatedAt: '2026-03-02',
	terminatedBy: 'tenant'
};

describe('fullYears', () => {
	it('counts the anniversaries up to and including the day', () => {
		expect(fullYears('2021-03-02', '2026-03-01')).toBe(4);
		expect(fullYears('2021-03-02', '2026-03-02')).toBe(5);
		expect(fullYears('2021-03-02', '2026-12-31')).toBe(5);
		expect(fullYears('2026-01-01', '2026-06-30')).toBe(0);
	});
});

describe('noticePeriodMonths', () => {
	it('is three months for a tenant, whatever the tenancy', () => {
		expect(noticePeriodMonths({ ...tenant, startDate: '2010-01-01' })).toBe(3);
	});

	it('grows for a landlord after five and eight years of tenancy', () => {
		const landlord = { ...tenant, terminatedBy: 'landlord' as const };
		// 2024-01-01 to 2026-03-02: 2 full years.
		expect(noticePeriodMonths(landlord)).toBe(3);
		// 2021-03-02 to 2026-03-02: exactly 5 years.
		expect(noticePeriodMonths({ ...landlord, startDate: '2021-03-02' })).toBe(6);
		// 2021-03-03 to 2026-03-02: one day short of 5 years.
		expect(noticePeriodMonths({ ...landlord, startDate: '2021-03-03' })).toBe(3);
		// 2017-06-01 to 2026-03-02: 8 years and 9 months.
		expect(noticePeriodMonths({ ...landlord, startDate: '2017-06-01' })).toBe(9);
	});

	it('keeps three months for commercial and parking leases', () => {
		const old = { ...tenant, startDate: '2010-01-01', terminatedBy: 'landlord' as const };
		expect(noticePeriodMonths({ ...old, kind: 'commercial' })).toBe(3);
		expect(noticePeriodMonths({ ...old, kind: 'parking' })).toBe(3);
	});
});

describe('proposedEndDate', () => {
	it('ends at the end of the month after next when the notice arrives by the third working day', () => {
		// Received Monday 2 March 2026 (first working day): March + 2 = May.
		expect(proposedEndDate(tenant)).toBe('2026-05-31');
		// Received on the third working day itself (Wednesday 4 March).
		expect(proposedEndDate({ ...tenant, terminatedAt: '2026-03-04' })).toBe('2026-05-31');
	});

	it('counts a later notice for the following month', () => {
		// Received Thursday 5 March 2026: April + 2 = June.
		expect(proposedEndDate({ ...tenant, terminatedAt: '2026-03-05' })).toBe('2026-06-30');
		// Received 31 March: April + 2 = June.
		expect(proposedEndDate({ ...tenant, terminatedAt: '2026-03-31' })).toBe('2026-06-30');
	});

	it('handles the turn of the year and short months', () => {
		// December 2026: Tue 1st, Wed 2nd, Thu 3rd are the first three working days.
		expect(proposedEndDate({ ...tenant, terminatedAt: '2026-12-03' })).toBe('2027-02-28');
		expect(proposedEndDate({ ...tenant, terminatedAt: '2026-12-04' })).toBe('2027-03-31');
		// January 2026: Thu 1st, Fri 2nd, Mon 5th (Saturday the 3rd does not count).
		expect(proposedEndDate({ ...tenant, terminatedAt: '2026-01-03' })).toBe('2026-03-31');
		expect(proposedEndDate({ ...tenant, terminatedAt: '2026-01-05' })).toBe('2026-03-31');
		expect(proposedEndDate({ ...tenant, terminatedAt: '2026-01-06' })).toBe('2026-04-30');
	});

	it('adds the landlord months to the end of the month', () => {
		const landlord = { ...tenant, terminatedBy: 'landlord' as const };
		// 7 full years: May + 3 = August.
		expect(proposedEndDate({ ...landlord, startDate: '2019-01-01' })).toBe('2026-08-31');
		// 8 full years and more: May + 6 = November.
		expect(proposedEndDate({ ...landlord, startDate: '2017-06-01' })).toBe('2026-11-30');
		// A commercial lease of twenty years: still May.
		expect(proposedEndDate({ ...landlord, kind: 'commercial', startDate: '2006-01-01' })).toBe(
			'2026-05-31'
		);
	});
});

describe('leaseEndDeadlines', () => {
	it('derives the three follow-up deadlines from the end date', () => {
		expect(leaseEndDeadlines('2026-05-31')).toEqual({
			readMeters: '2026-05-31',
			// 31 May + 6 months = 30 November (the day is clamped to the month).
			settleDeposit: '2026-11-30',
			// The calendar year ends 31 December 2026; twelve months later.
			operatingCostStatement: '2027-12-31'
		});
		expect(leaseEndDeadlines('2026-08-31').settleDeposit).toBe('2027-02-28');
	});
});
