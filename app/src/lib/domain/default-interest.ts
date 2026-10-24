import { addDays, daysBetween, type IsoDate } from '../dates';
import type { OpenItem } from './reminders';

// Verzugszinsen (§ 288 Abs. 1 BGB) on overdue rent: five percentage points above the Basiszinssatz
// (§ 247 BGB). A private landlord is a consumer, so the nine points of § 288 Abs. 2 BGB, which need
// a transaction without any consumer, are not used. Rent is due on a calendar date, so the tenant
// is in default from the day after the due date without a reminder (§ 286 Abs. 2 Nr. 1 BGB).

/** § 288 Abs. 1 Satz 2 BGB: percentage points above the Basiszinssatz, in basis points. */
export const DEFAULT_INTEREST_MARGIN = 500;

/** The Basiszinssatz from `validFrom` on, in basis points (152 = 1,52 %). */
export type BaseRate = { validFrom: IsoDate; rate: number };

/** The first day of the half-year the date falls in: the Basiszinssatz changes on 1 January and 1 July. */
export function halfYearStart(date: IsoDate): IsoDate {
	return `${date.slice(0, 4)}-${date.slice(5, 7) < '07' ? '01' : '07'}-01`;
}

/** The Basiszinssatz on a day: the rate of the latest half-year starting by then, if known. */
export function baseRateOn(rates: readonly BaseRate[], date: IsoDate): BaseRate | undefined {
	let found: BaseRate | undefined;
	for (const rate of rates) {
		if (rate.validFrom <= date && (!found || rate.validFrom > found.validFrom)) found = rate;
	}
	return found;
}

export type InterestResult = {
	/** In cents, half-up, the items added up. */
	amount: number;
	/** The rates used, oldest first, each with the default interest rate in basis points. */
	periods: { validFrom: IsoDate; baseRate: number; interestRate: number }[];
	/** Days the known rates do not cover (before the first one stored); no interest for them. */
	uncoveredDays: number;
};

/**
 * The default interest on the open items up to `asOf`, day by day at the rate of each day, on a
 * 365-day year. The open amount of each item is taken for the whole time since its due date, so
 * a part paid late earns no interest here; the figure errs on the tenant's side.
 */
export function defaultInterest(
	items: readonly OpenItem[],
	rates: readonly BaseRate[],
	asOf: IsoDate
): InterestResult {
	const sorted = [...rates].sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1));
	let exact = 0;
	let uncoveredDays = 0;
	const used = new Map<IsoDate, BaseRate>();
	for (const item of items) {
		const first = addDays(item.dueDate, 1);
		if (first > asOf) continue;
		let itemInterest = 0;
		for (let index = 0; index < sorted.length; index += 1) {
			const rate = sorted[index];
			const next = sorted[index + 1]?.validFrom;
			const start = rate.validFrom > first ? rate.validFrom : first;
			const end = next && addDays(next, -1) < asOf ? addDays(next, -1) : asOf;
			if (start > end) continue;
			const days = daysBetween(start, end) + 1;
			itemInterest += (item.open * (rate.rate + DEFAULT_INTEREST_MARGIN) * days) / (10_000 * 365);
			used.set(rate.validFrom, rate);
		}
		const firstKnown = sorted[0]?.validFrom;
		if (!firstKnown || first < firstKnown) {
			const end = firstKnown && addDays(firstKnown, -1) < asOf ? addDays(firstKnown, -1) : asOf;
			uncoveredDays = Math.max(uncoveredDays, daysBetween(first, end) + 1);
		}
		exact += itemInterest;
	}
	return {
		amount: Math.max(0, Math.round(exact)),
		periods: [...used.values()]
			.sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1))
			.map((rate) => ({
				validFrom: rate.validFrom,
				baseRate: rate.rate,
				interestRate: rate.rate + DEFAULT_INTEREST_MARGIN
			})),
		uncoveredDays
	};
}

/** `152` → `1,52 %`, `-88` → `-0,88 %`. */
export function formatRate(basisPoints: number): string {
	return `${(basisPoints / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0%`;
}
