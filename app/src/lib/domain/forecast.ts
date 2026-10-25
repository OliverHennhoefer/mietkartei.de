import {
	addMonths,
	addMonthsToMonth,
	firstOfMonth,
	monthOf,
	monthsInRange,
	type IsoDate,
	type IsoMonth
} from '../dates';
import type { ExpenseCategory } from '../server/db/schema';
import {
	indexSituation,
	type HistoryChange,
	type IndexLease,
	type IndexValueRow
} from './index-rent';
import { monthlyAmounts, rentOn, total, type LeaseTerm } from './rents';

// Prognose: the next twelve months from what is known today. The rent is what the leases owe
// with every approved change (Staffel steps included); an Indexmiete that may rise is added from
// the first day it may take effect, as a second line. The costs are the average month of the
// last twelve. Next to it: what each lease may still rise by, and the expected result of the
// next Nebenkostenabrechnung from the last one. Pure: the server module loads the rows.

export type ForecastLease = IndexLease &
	LeaseTerm & {
		id: string;
		label: string;
		propertyId: string;
		changes: readonly HistoryChange[];
	};

export type ForecastInput = {
	today: IsoDate;
	leases: readonly ForecastLease[];
	indexValues: readonly IndexValueRow[];
	expenses: readonly {
		date: IsoDate;
		amount: number;
		category: ExpenseCategory;
		propertyId: string | null;
	}[];
	/** The latest approved statement of each lease. */
	statements: readonly {
		leaseId: string;
		periodEnd: IsoDate;
		/** The costs of the lease and the days it ran in the period. */
		costs: number;
		days: number;
		balance: number;
	}[];
};

export type ForecastMonth = {
	month: IsoMonth;
	/** What the leases owe, with every approved change. */
	rent: number;
	/** The index increases that may take effect by then. */
	increases: number;
	costs: number;
};

export type RentIncrease = {
	leaseId: string;
	label: string;
	kind: 'graduated' | 'indexed' | 'comparative';
	/** The first day the new rent applies or may apply. */
	from: IsoDate;
	currentBaseRent: number;
	/** Per month; for 'comparative' the most the Kappungsgrenze allows. */
	increase: number;
};

export type SettlementEstimate = {
	leaseId: string;
	label: string;
	lastPeriodEnd: IsoDate;
	lastBalance: number;
	/** The costs of a year at the level of the last statement. */
	yearlyCosts: number;
	/** The prepayments of a year at today's amounts. */
	yearlyPrepayments: number;
	/** yearlyCosts − yearlyPrepayments: positive = Nachzahlung. */
	balance: number;
	/** The monthly prepayment that would cover the costs, rounded up to whole euros. */
	suggestedPrepayment: number;
	currentPrepayment: number;
};

export type Forecast = {
	months: ForecastMonth[];
	/** The average month of the last twelve: every expense, loan rates included. */
	monthlyCosts: number;
	increases: RentIncrease[];
	settlements: SettlementEstimate[];
};

/** § 558 Abs. 3 BGB: at most 20 % in three years; some Länder set 15 % for some cities. */
export const cappingLimit = 0.2;

const byValidFrom = (a: HistoryChange, b: HistoryChange) =>
	a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0;

function forecastMonths(today: IsoDate): IsoMonth[] {
	const first = addMonthsToMonth(monthOf(today), 1);
	return monthsInRange(first, addMonthsToMonth(first, 11));
}

/** The first day after the latest approved change of the base rent, the lease start included. */
function lastBaseChange(changes: readonly HistoryChange[], today: IsoDate): IsoDate | undefined {
	let previous: number | undefined;
	let last: IsoDate | undefined;
	const approved = changes
		.filter((change) => change.status === 'approved' && change.validFrom <= today)
		.sort(byValidFrom);
	for (const change of approved) {
		if (previous === undefined || change.baseRent !== previous) last = change.validFrom;
		previous = change.baseRent;
	}
	return last;
}

function rentIncrease(
	lease: ForecastLease,
	values: readonly IndexValueRow[],
	today: IsoDate
): RentIncrease | undefined {
	const current = rentOn(lease.changes, today);
	if (!current) return undefined;
	const base = { leaseId: lease.id, label: lease.label, currentBaseRent: current.baseRent };
	if (lease.rentModel === 'graduated') {
		const next = lease.changes
			.filter((change) => change.status === 'approved' && change.validFrom > today)
			.sort(byValidFrom)
			.find((change) => change.baseRent !== current.baseRent);
		return next
			? {
					...base,
					kind: 'graduated',
					from: next.validFrom,
					increase: next.baseRent - current.baseRent
				}
			: undefined;
	}
	if (lease.rentModel === 'indexed') {
		const situation = indexSituation(lease, lease.changes, values, today);
		if (!situation.proposal || situation.proposal.increase <= 0 || situation.pending) {
			return undefined;
		}
		const from =
			situation.waitingUntil && situation.waitingUntil > situation.provisionalFrom
				? situation.waitingUntil
				: situation.provisionalFrom;
		return { ...base, kind: 'indexed', from, increase: situation.proposal.increase };
	}
	if (lease.kind !== 'residential') return undefined;
	// § 558: a year after the last change the landlord may ask, and the new rent applies from the
	// third month after; it may not rise by more than the Kappungsgrenze in three years.
	const last = lastBaseChange(lease.changes, today);
	if (!last) return undefined;
	const earliest = firstOfMonth(addMonthsToMonth(monthOf(addMonths(last, 12)), 3));
	const nextMonth = firstOfMonth(addMonthsToMonth(monthOf(today), 3));
	const from = earliest > nextMonth ? earliest : nextMonth;
	const threeYearsBefore =
		rentOn(lease.changes, addMonths(from, -36)) ?? rentOn(lease.changes, last);
	if (!threeYearsBefore) return undefined;
	const increase = Math.round(threeYearsBefore.baseRent * (1 + cappingLimit)) - current.baseRent;
	return increase > 0 ? { ...base, kind: 'comparative', from, increase } : undefined;
}

export function forecast(input: ForecastInput, options: { propertyId: string | null }): Forecast {
	const { today } = input;
	const leases = input.leases.filter(
		(lease) => !options.propertyId || lease.propertyId === options.propertyId
	);
	const months = forecastMonths(today);

	// The last twelve full months before this one.
	const pastStart = firstOfMonth(addMonthsToMonth(monthOf(today), -12));
	const pastEnd = firstOfMonth(monthOf(today));
	const pastCosts = input.expenses
		.filter((expense) => expense.date >= pastStart && expense.date < pastEnd)
		.filter((expense) => (options.propertyId ? expense.propertyId === options.propertyId : true))
		.reduce((sum, expense) => sum + expense.amount, 0);
	const monthlyCosts = Math.round(pastCosts / 12);

	const increases = leases
		.filter((lease) => !lease.endDate || lease.endDate > today)
		.flatMap((lease) => rentIncrease(lease, input.indexValues, today) ?? [])
		.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
	const indexed = increases.filter((increase) => increase.kind === 'indexed');

	const forecastMonthsRows = months.map((month) => {
		let rent = 0;
		for (const lease of leases) rent += total(monthlyAmounts(lease.changes, lease, month));
		const firstDay = firstOfMonth(month);
		const extra = indexed
			.filter((increase) => increase.from <= firstDay)
			.reduce((sum, increase) => {
				const lease = leases.find((row) => row.id === increase.leaseId)!;
				const running = !lease.endDate || lease.endDate >= firstDay;
				return running ? sum + increase.increase : sum;
			}, 0);
		return { month, rent, increases: extra, costs: monthlyCosts };
	});

	const latest = new Map(input.statements.map((row) => [row.leaseId, row]));
	const settlements: SettlementEstimate[] = [];
	for (const lease of leases) {
		const statement = latest.get(lease.id);
		if (!statement || statement.days <= 0) continue;
		if (lease.endDate && lease.endDate <= today) continue;
		const current = rentOn(lease.changes, today);
		if (!current) continue;
		const currentPrepayment = current.operatingCostPrepayment + current.heatingCostPrepayment;
		const yearlyCosts = Math.round((statement.costs * 365) / statement.days);
		const yearlyPrepayments = currentPrepayment * 12;
		settlements.push({
			leaseId: lease.id,
			label: lease.label,
			lastPeriodEnd: statement.periodEnd,
			lastBalance: statement.balance,
			yearlyCosts,
			yearlyPrepayments,
			balance: yearlyCosts - yearlyPrepayments,
			suggestedPrepayment: Math.ceil(yearlyCosts / 12 / 100) * 100,
			currentPrepayment
		});
	}
	settlements.sort((a, b) => b.balance - a.balance);

	return { months: forecastMonthsRows, monthlyCosts, increases, settlements };
}
