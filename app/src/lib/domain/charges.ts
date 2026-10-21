import { monthOf, monthsInRange, type IsoDate, type IsoMonth } from '../dates';
import { nthWorkingDay } from '../working-days';
import { monthlyAmounts, total, type RentChange } from './rents';

// The monthly rent charges (Sollstellungen) a lease should have, derived from its term and the
// rent history. The ledger compares them with the stored rows and brings those in line, so a
// backdated rent change or a new end date corrects the ledger without anyone re-posting.

export type ExpectedCharge = {
	period: IsoMonth;
	/**
	 * The n-th working day of the month (§ 556b BGB), public holidays skipped; in the first month
	 * not before the start of the charges.
	 */
	dueDate: IsoDate;
	baseRent: number;
	operatingCostPrepayment: number;
	heatingCostPrepayment: number;
	/** The three parts added up. */
	amount: number;
};

export type ChargeTerm = {
	startDate: IsoDate;
	endDate: IsoDate | null;
	/** Charges start here instead of at startDate when set and later; see leases.ledgerStart. */
	ledgerStart: IsoDate | null;
	/** The rent is due on the n-th working day of the month. */
	rentDueDay: number;
};

/**
 * One charge per month from the ledger start to `untilMonth` (or the end of the lease, whichever
 * is earlier). The first and last month are prorated by days, as is a month with a rent change
 * in the middle. Months before the first approved change carry no known rent and are skipped;
 * only approved changes count.
 */
export function expectedRentCharges(
	lease: ChargeTerm,
	changes: readonly RentChange[],
	untilMonth: IsoMonth
): ExpectedCharge[] {
	let firstKnown: IsoDate | undefined;
	for (const change of changes) {
		if (change.status !== 'approved') continue;
		if (!firstKnown || change.validFrom < firstKnown) firstKnown = change.validFrom;
	}
	if (!firstKnown) return [];

	// A ledger start before the lease begins means nothing; the lease cannot owe rent earlier.
	const start =
		lease.ledgerStart && lease.ledgerStart > lease.startDate ? lease.ledgerStart : lease.startDate;
	const term = { startDate: start, endDate: lease.endDate };
	const endMonth = lease.endDate ? monthOf(lease.endDate) : untilMonth;
	const lastMonth = endMonth < untilMonth ? endMonth : untilMonth;

	const charges: ExpectedCharge[] = [];
	for (const period of monthsInRange(monthOf(start), lastMonth)) {
		if (period < monthOf(firstKnown)) continue;
		const amounts = monthlyAmounts(changes, term, period);
		if (amounts.days === 0) continue;
		// A term starting after the due day of its first month owes that month's rent from its
		// start, not before it (a lease from 15 January is not in arrears on 6 January).
		const dueDate = nthWorkingDay(period, lease.rentDueDay);
		charges.push({
			period,
			dueDate: dueDate < start ? start : dueDate,
			baseRent: amounts.baseRent,
			operatingCostPrepayment: amounts.operatingCostPrepayment,
			heatingCostPrepayment: amounts.heatingCostPrepayment,
			amount: total(amounts)
		});
	}
	return charges;
}

/** A stored rent charge, as far as the diff needs it. */
export type StoredCharge = ExpectedCharge & { id: string };

export type ChargeDiff = {
	/** Months with no row yet. */
	insert: ExpectedCharge[];
	/** Rows whose amounts or due date no longer match, with the id to keep. */
	update: (ExpectedCharge & { id: string })[];
	/** Ids of rows for months that are no longer expected (outside the term now). */
	remove: string[];
};

/** What has to change so that the stored rent charges equal the expected ones. */
export function diffCharges(
	existing: readonly StoredCharge[],
	expected: readonly ExpectedCharge[]
): ChargeDiff {
	const byPeriod = new Map<IsoMonth, StoredCharge>();
	const remove: string[] = [];
	for (const row of existing) {
		// The unique index allows one rent row per month; a second one would only confuse the diff.
		if (byPeriod.has(row.period)) remove.push(row.id);
		else byPeriod.set(row.period, row);
	}

	const insert: ExpectedCharge[] = [];
	const update: (ExpectedCharge & { id: string })[] = [];
	for (const charge of expected) {
		const row = byPeriod.get(charge.period);
		if (!row) {
			insert.push(charge);
			continue;
		}
		byPeriod.delete(charge.period);
		if (!sameCharge(row, charge)) update.push({ ...charge, id: row.id });
	}
	for (const row of byPeriod.values()) remove.push(row.id);
	return { insert, update, remove };
}

function sameCharge(a: ExpectedCharge, b: ExpectedCharge): boolean {
	return (
		a.dueDate === b.dueDate &&
		a.baseRent === b.baseRent &&
		a.operatingCostPrepayment === b.operatingCostPrepayment &&
		a.heatingCostPrepayment === b.heatingCostPrepayment &&
		a.amount === b.amount
	);
}
