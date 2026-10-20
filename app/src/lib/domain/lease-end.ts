import {
	addMonths,
	addMonthsToMonth,
	lastOfMonth,
	monthOf,
	nthWorkingDay,
	type IsoDate
} from '../dates';
import type { LeaseKind, TerminatedBy } from '../server/db/schema';

// The end of a lease after a notice (Kündigung), § 573c BGB, and the deadlines that follow from
// the end date. Pure functions; the lease overview prefills its "Vertrag beenden" form with them.

export type LeaseEndInput = {
	kind: LeaseKind;
	/** The day the tenant got the keys; the notice period of the landlord grows with the tenancy. */
	startDate: IsoDate;
	/** The day the notice was received (Zugang der Kündigung). */
	terminatedAt: IsoDate;
	terminatedBy: TerminatedBy;
};

/** Full years from `start` to `at`: 4 on the day before the fifth anniversary, 5 on it. */
export function fullYears(start: IsoDate, at: IsoDate): number {
	const years = Number(at.slice(0, 4)) - Number(start.slice(0, 4));
	return at.slice(5) < start.slice(5) ? years - 1 : years;
}

/**
 * The notice period in months: three for everyone (the lease ends at the end of the month after
 * next), and for a landlord's notice on a residential lease three more after five years of
 * tenancy and six more after eight (§ 573c Abs. 1 BGB). Commercial and parking leases keep the
 * plain three months here; their own rules (§ 580a BGB) are not modelled in the spike.
 */
export function noticePeriodMonths(input: LeaseEndInput): number {
	if (input.kind !== 'residential' || input.terminatedBy !== 'landlord') return 3;
	const years = fullYears(input.startDate, input.terminatedAt);
	if (years >= 8) return 9;
	if (years >= 5) return 6;
	return 3;
}

/**
 * The end date § 573c BGB proposes: a notice received by the third working day of a month counts
 * for that month and ends the lease at the end of the month after next; a later notice counts
 * for the following month. The landlord's longer periods add whole months to that.
 */
export function proposedEndDate(input: LeaseEndInput): IsoDate {
	const month = monthOf(input.terminatedAt);
	const inTime = input.terminatedAt <= nthWorkingDay(month, 3);
	const baseMonth = inTime ? month : addMonthsToMonth(month, 1);
	return lastOfMonth(addMonthsToMonth(baseMonth, noticePeriodMonths(input) - 1));
}

export type LeaseEndDeadlines = {
	/** Zählerstände ablesen: on the last day of the lease. */
	readMeters: IsoDate;
	/** Kaution abrechnen: six months after the end (the usual Prüffrist). */
	settleDeposit: IsoDate;
	/** Betriebskostenabrechnung: twelve months after the end of the calendar year the lease ended in (§ 556 Abs. 3 BGB). */
	operatingCostStatement: IsoDate;
};

/** What the landlord has to do once the end date is known. */
export function leaseEndDeadlines(endDate: IsoDate): LeaseEndDeadlines {
	const periodEnd = `${endDate.slice(0, 4)}-12-31`;
	return {
		readMeters: endDate,
		settleDeposit: addMonths(endDate, 6),
		operatingCostStatement: addMonths(periodEnd, 12)
	};
}
