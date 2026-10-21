import { describe, expect, it } from 'vitest';
import {
	fullYears,
	leaseEndDeadlines,
	noticeDeadline,
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
		// January 2026: Neujahr on Thu 1st, then Fri 2nd, Sat 3rd and Mon 5th.
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
		// A parking lease of twenty years: still May (§ 580a Abs. 1 Nr. 3 BGB).
		expect(proposedEndDate({ ...landlord, kind: 'parking', startDate: '2006-01-01' })).toBe(
			'2026-05-31'
		);
	});

	it('counts Saturday as a Werktag for the notice (BGH VIII ZR 206/04)', () => {
		// August 2026 starts on a Saturday: Sat 1, Mon 3, Tue 4. A notice on Wed 5 August is late,
		// so it counts for September: September + 2 = November.
		expect(proposedEndDate({ ...tenant, terminatedAt: '2026-08-04' })).toBe('2026-10-31');
		expect(proposedEndDate({ ...tenant, terminatedAt: '2026-08-05' })).toBe('2026-11-30');
	});

	it('ends a commercial lease at the end of the next quarter (§ 580a Abs. 2 BGB)', () => {
		const commercial = { ...tenant, kind: 'commercial' as const };
		// 2 March 2026 is past the third Werktag of the quarter (Mon 5 January), so the notice
		// counts for the quarter from April: end of the next quarter, 30 September.
		expect(proposedEndDate(commercial)).toBe('2026-09-30');
		// April 2026: Wed 1, Thu 2, Karfreitag 3, Sat 4 is the third Werktag, and Ostermontag
		// moves the deadline to Tue 7: end of the third quarter.
		expect(proposedEndDate({ ...commercial, terminatedAt: '2026-04-07' })).toBe('2026-09-30');
		expect(proposedEndDate({ ...commercial, terminatedAt: '2026-04-08' })).toBe('2026-12-31');
		// Late in the year: the notice counts for the first quarter of 2027, ending 30 June 2027.
		expect(proposedEndDate({ ...commercial, terminatedAt: '2026-11-10' })).toBe('2027-06-30');
		// The landlord's longer periods of § 573c do not apply.
		expect(
			proposedEndDate({
				...commercial,
				terminatedBy: 'landlord',
				startDate: '2006-01-01',
				terminatedAt: '2026-04-07'
			})
		).toBe('2026-09-30');
	});
});

describe('noticeDeadline', () => {
	it('is the third Werktag, Saturday included, moved from a Saturday to Monday (§ 193 BGB)', () => {
		// March 2026: Sun 1, Mon 2, Tue 3, Wed 4.
		expect(noticeDeadline('2026-03')).toBe('2026-03-04');
		// August 2026: Sat 1, Mon 3, Tue 4 (the Monday-to-Friday count would give Wed 5).
		expect(noticeDeadline('2026-08')).toBe('2026-08-04');
		// May 2026: Fri 1 is Tag der Arbeit, so Sat 2, Mon 4, Tue 5.
		expect(noticeDeadline('2026-05')).toBe('2026-05-05');
		// June 2026: Mon 1, Tue 2, Wed 3.
		expect(noticeDeadline('2026-06')).toBe('2026-06-03');
		// September 2029: Sat 1, Mon 3, Tue 4.
		expect(noticeDeadline('2029-09')).toBe('2029-09-04');
		// July 2027: Thu 1, Fri 2, Sat 3, which moves to Mon 5.
		expect(noticeDeadline('2027-07')).toBe('2027-07-05');
	});

	it('does not count public holidays as Werktage', () => {
		// January 2026: Neujahr on Thu 1, then Fri 2, Sat 3, Mon 5.
		expect(noticeDeadline('2026-01')).toBe('2026-01-05');
		// October 2025: Wed 1, Thu 2, Fri 3 is Tag der Deutschen Einheit, so Sat 4 is the third
		// Werktag, which moves to Mon 6.
		expect(noticeDeadline('2025-10')).toBe('2025-10-06');
		// October 2026: Thu 1, Fri 2, Sat 3 is Tag der Deutschen Einheit, so Mon 5.
		expect(noticeDeadline('2026-10')).toBe('2026-10-05');
		// April 2026: Wed 1, Thu 2, Karfreitag 3, Sat 4 is the third Werktag; Mon 6 is
		// Ostermontag, so the deadline moves to Tue 7.
		expect(noticeDeadline('2026-04')).toBe('2026-04-07');
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
