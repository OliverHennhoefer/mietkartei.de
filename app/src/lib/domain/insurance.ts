import { addDays, addMonths, daysInclusive, type DateRange, type IsoDate } from '../dates';
import { proRata } from '../money';
import type { InsuranceKind } from '../server/db/schema';

// Versicherungen: a policy renews every year on its Hauptfälligkeit unless cancelled in time. The
// premium of Sach- und Haftpflichtversicherungen may be passed on to the tenants (§ 2 Nr. 13
// BetrKV); a Beleg over the insurance year is prorated into each statement by days.

/** The kinds whose premium is a Betriebskosten item (§ 2 Nr. 13 BetrKV). */
export const allocableInsuranceKinds: readonly InsuranceKind[] = [
	'building',
	'liability',
	'glass',
	'oil_tank'
];

/** The insurance year that starts `years` after the renewal date (negative for earlier ones). */
export function insuranceYear(renewalDate: IsoDate, years: number): DateRange {
	// Counted from the stored date, so the day of month does not drift.
	const start = addMonths(renewalDate, 12 * years);
	return { start, end: addDays(addMonths(renewalDate, 12 * (years + 1)), -1) };
}

/** The next renewal after `today`; the stored date itself while it lies ahead. */
export function nextRenewal(renewalDate: IsoDate, today: IsoDate): IsoDate {
	let years = 0;
	while (addMonths(renewalDate, 12 * years) <= today) years += 1;
	return addMonths(renewalDate, 12 * years);
}

/** The last day a cancellation may arrive to end the policy before `renewal`. */
export function noticeDeadline(renewal: IsoDate, noticeMonths: number): IsoDate {
	return addDays(addMonths(renewal, -noticeMonths), -1);
}

/**
 * The next renewal the policy can still be cancelled for, with the deadline for that: the next
 * renewal while its deadline has not passed, else the one a year later.
 */
export function nextCancellation(
	renewalDate: IsoDate,
	noticeMonths: number,
	today: IsoDate
): { renewal: IsoDate; deadline: IsoDate } {
	let renewal = nextRenewal(renewalDate, today);
	let deadline = noticeDeadline(renewal, noticeMonths);
	while (deadline < today) {
		renewal = addMonths(renewal, 12);
		deadline = noticeDeadline(renewal, noticeMonths);
	}
	return { renewal, deadline };
}

/** An insurance year, cut at the end of cover; `fullEnd` is where it would end uncut. */
export type InsuranceYearRange = DateRange & { fullEnd: IsoDate };

/**
 * The insurance years that overlap the given calendar years, oldest first: the ones a statement
 * of those years needs a Beleg for. Years before the stored renewal date are left out, as are
 * years after the end of cover.
 */
export function insuranceYearsFor(
	policy: { renewalDate: IsoDate; endDate: IsoDate | null },
	calendarYears: number[]
): InsuranceYearRange[] {
	if (calendarYears.length === 0) return [];
	const from = `${Math.min(...calendarYears)}-01-01`;
	const to = `${Math.max(...calendarYears)}-12-31`;
	const years: InsuranceYearRange[] = [];
	for (let index = 0; ; index += 1) {
		const year = insuranceYear(policy.renewalDate, index);
		if (year.start > to || (policy.endDate && year.start > policy.endDate)) break;
		if (year.end < from) continue;
		const end = policy.endDate && policy.endDate < year.end ? policy.endDate : year.end;
		years.push({ start: year.start, end, fullEnd: year.end });
	}
	return years;
}

/** The premium of an insurance year: the annual one, prorated by days when cover ends early. */
export function premiumFor(annualPremium: number, year: InsuranceYearRange): number {
	if (year.end === year.fullEnd) return annualPremium;
	return proRata(
		annualPremium,
		daysInclusive(year.start, year.end),
		daysInclusive(year.start, year.fullEnd)
	);
}
