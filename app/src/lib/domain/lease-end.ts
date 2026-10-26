import {
	addDays,
	addMonths,
	addMonthsToMonth,
	firstOfMonth,
	lastOfMonth,
	monthOf,
	weekday,
	type IsoDate,
	type IsoMonth
} from '../dates';
import type { LeaseKind, TerminatedBy } from '../server/db/schema';
import { statementDeadline } from './statement';
import { isPublicHoliday, isWorkingDay, type GermanState } from '../working-days';

// The end of a lease after a notice (Kündigung), § 573c BGB for dwellings and § 580a BGB for
// commercial premises and parking, and the deadlines that follow from the end date. Pure
// functions; the lease overview prefills and checks its "Vertrag beenden" form with them.

export type LeaseEndInput = {
	kind: LeaseKind;
	/** The day the tenant got the keys; the notice period of the landlord grows with the tenancy. */
	startDate: IsoDate;
	/** The day the notice was received (Zugang der Kündigung). */
	terminatedAt: IsoDate;
	terminatedBy: TerminatedBy;
	/** Bundesland of the property, whose holidays are no Werktage. */
	state: GermanState | null;
};

/** Full years from `start` to `at`: 4 on the day before the fifth anniversary, 5 on it. */
export function fullYears(start: IsoDate, at: IsoDate): number {
	const years = Number(at.slice(0, 4)) - Number(start.slice(0, 4));
	return at.slice(5) < start.slice(5) ? years - 1 : years;
}

/**
 * The notice period in months: three for everyone (the lease ends at the end of the month after
 * next), and for a landlord's notice on a residential lease three more after five years of
 * tenancy and six more after eight (§ 573c Abs. 1 BGB). Commercial leases follow the quarters of
 * § 580a Abs. 2 BGB instead (see proposedEndDate); parking leases with a monthly rent keep the
 * plain three months (§ 580a Abs. 1 Nr. 3 BGB).
 */
export function noticePeriodMonths(input: LeaseEndInput): number {
	if (input.kind !== 'residential' || input.terminatedBy !== 'landlord') return 3;
	const years = fullYears(input.startDate, input.terminatedAt);
	if (years >= 8) return 9;
	if (years >= 5) return 6;
	return 3;
}

/**
 * The last day a notice counts for the month: the third Werktag. For § 573c and § 580a BGB
 * Saturday is a Werktag (BGH VIII ZR 206/04), unlike for the rent due day; Sundays and the
 * public holidays of the state are not. When the third Werktag is a Saturday, the deadline moves to
 * the next working day (§ 193 BGB), past a holiday on the Monday too.
 */
export function noticeDeadline(month: IsoMonth, state: GermanState | null): IsoDate {
	let date = firstOfMonth(month);
	let seen = 0;
	for (;;) {
		if (weekday(date) !== 0 && !isPublicHoliday(date, state)) seen += 1;
		if (seen === 3) break;
		date = addDays(date, 1);
	}
	while (!isWorkingDay(date, state)) date = addDays(date, 1);
	return date;
}

/**
 * The end date the law proposes. Dwellings and parking (§ 573c, § 580a Abs. 1 Nr. 3 BGB): a
 * notice received by the third Werktag of a month counts for that month and ends the lease at the
 * end of the month after next; a later notice counts for the following month; the landlord's
 * longer periods add whole months. Commercial premises (§ 580a Abs. 2 BGB): a notice received by
 * the third Werktag of a quarter ends the lease at the end of the next quarter.
 */
export function proposedEndDate(input: LeaseEndInput): IsoDate {
	const month = monthOf(input.terminatedAt);
	if (input.kind === 'commercial') {
		const monthNumber = Number(month.slice(5, 7));
		const quarterStart = addMonthsToMonth(month, -((monthNumber - 1) % 3));
		const inTime =
			quarterStart === month && input.terminatedAt <= noticeDeadline(month, input.state);
		const baseQuarter = inTime ? quarterStart : addMonthsToMonth(quarterStart, 3);
		return lastOfMonth(addMonthsToMonth(baseQuarter, 5));
	}
	const inTime = input.terminatedAt <= noticeDeadline(month, input.state);
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
	return {
		readMeters: endDate,
		settleDeposit: addMonths(endDate, 6),
		operatingCostStatement: statementDeadline(`${endDate.slice(0, 4)}-12-31`)
	};
}
