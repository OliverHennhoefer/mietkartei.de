import type { DateRange, IsoDate } from '../dates';
import type { ExpenseCategory } from '../server/db/schema';

// Rendite und Cashflow: what the portfolio or a property brought in over a window, set against
// what it cost to buy (Anschaffungskosten) and the money of the owner in it (the Anschaffungskosten
// minus the loan). Pure: the server module loads the rows.
//
// Money in is the rent received (Ist, utilities included); the Bewirtschaftung is every expense
// except the loan, so the utilities passed on cancel out against the prepayments received. A
// Darlehensrate booked as one sum (loan_payment) is split with the interest of its year from the
// Zinsbescheinigung, in proportion to the rates paid in the window. The bank sends it after the
// year, so a year without one takes the share of interest in the rates of the latest year before
// it that has one (an estimate, slightly high, as the share falls each year). Without any the
// rate stays unsplit and the return on equity, which needs the interest, is not given.

export type ReturnsProperty = {
	id: string;
	name: string;
	/** Anschaffungskosten in cents, price plus Nebenkosten; null = not entered. */
	acquisitionCost: number | null;
	/** Darlehenssumme in cents, what the bank lent for it; null = not entered. */
	loanAmount: number | null;
};

export type ReturnsInput = {
	properties: readonly ReturnsProperty[];
	units: readonly { id: string; propertyId: string }[];
	leases: readonly { id: string; unitId: string }[];
	charges: readonly { leaseId: string; period: string; baseRent: number }[];
	payments: readonly { leaseId: string; date: IsoDate; amount: number }[];
	expenses: readonly {
		date: IsoDate;
		amount: number;
		category: ExpenseCategory;
		propertyId: string | null;
	}[];
	/** The interest of a year from the Zinsbescheinigung, per property. */
	interest: readonly { propertyId: string; year: number; amount: number }[];
};

/** Money over the window, in cents. `cashflow` is what is left after every expense. */
export type Flows = {
	/** Kaltmiete charged (Soll). */
	baseRent: number;
	received: number;
	/** Bewirtschaftung: every expense but the loan. */
	operating: number;
	interest: number;
	/** The part of `interest` estimated from an earlier year's Zinsbescheinigung. */
	estimatedInterest: number;
	repayment: number;
	/** Darlehensraten without the interest of their year, not split into interest and repayment. */
	unsplit: number;
	cashflow: number;
};

/** Yearly rates (0.039 = 3,9 %); null when a figure they need is missing. */
export type Rates = {
	/** Kaltmiete a year / Anschaffungskosten. */
	gross: number | null;
	/** (received − Bewirtschaftung) a year / Anschaffungskosten. */
	net: number | null;
	/** (received − Bewirtschaftung − interest) a year / (Anschaffungskosten − loan). */
	equity: number | null;
};

export type PropertyReturns = Flows &
	Rates &
	ReturnsProperty & {
		/** Anschaffungskosten minus loan; null without either. */
		ownCapital: number | null;
	};

export type Returns = {
	/** Months in the window, for the figures a month and to annualise a shorter one. */
	months: number;
	/** The whole portfolio in view, portfolio-wide expenses included. */
	totals: Flows;
	/**
	 * The rates over the properties with Anschaffungskosten, from their own money only; how many of
	 * the properties in view that are.
	 */
	rates: Rates & { counted: number; acquisitionCost: number; ownCapital: number | null };
	properties: PropertyReturns[];
};

const loanCategories: readonly ExpenseCategory[] = [
	'loan_payment',
	'loan_interest',
	'loan_repayment'
];

const inRange = (date: string, range: DateRange) => date >= range.start && date <= range.end;

function monthsIn(range: DateRange): number {
	const [startYear, startMonth] = range.start.split('-').map(Number);
	const [endYear, endMonth] = range.end.split('-').map(Number);
	return Math.max(1, (endYear - startYear) * 12 + endMonth - startMonth + 1);
}

function emptyFlows(): Flows {
	return {
		baseRent: 0,
		received: 0,
		operating: 0,
		interest: 0,
		estimatedInterest: 0,
		repayment: 0,
		unsplit: 0,
		cashflow: 0
	};
}

function addFlows(total: Flows, flows: Flows): void {
	for (const key of Object.keys(total) as (keyof Flows)[]) total[key] += flows[key];
}

function rates(flows: Flows, acquisitionCost: number, ownCapital: number | null, months: number) {
	const yearly = (cents: number) => (cents * 12) / months;
	const operatingIncome = flows.received - flows.operating;
	return {
		gross: acquisitionCost > 0 ? yearly(flows.baseRent) / acquisitionCost : null,
		net: acquisitionCost > 0 ? yearly(operatingIncome) / acquisitionCost : null,
		equity:
			ownCapital !== null && ownCapital > 0 && flows.unsplit === 0
				? yearly(operatingIncome - flows.interest) / ownCapital
				: null
	};
}

export function returns(
	input: ReturnsInput,
	options: { range: DateRange; propertyId: string | null }
): Returns {
	const { range, propertyId } = options;
	const months = monthsIn(range);
	const inView = input.properties.filter((property) => !propertyId || property.id === propertyId);
	const flows = new Map(inView.map((property) => [property.id, emptyFlows()]));
	/** Portfolio-wide expenses, only counted for the whole portfolio. */
	const unassigned = emptyFlows();

	const propertyOfUnit = new Map(input.units.map((unit) => [unit.id, unit.propertyId]));
	const propertyOfLease = new Map(
		input.leases.map((lease) => [lease.id, propertyOfUnit.get(lease.unitId)])
	);

	for (const charge of input.charges) {
		const target = flows.get(propertyOfLease.get(charge.leaseId) ?? '');
		if (!target) continue;
		if (charge.period < range.start.slice(0, 7) || charge.period > range.end.slice(0, 7)) continue;
		target.baseRent += charge.baseRent;
	}
	for (const payment of input.payments) {
		const target = flows.get(propertyOfLease.get(payment.leaseId) ?? '');
		if (target && inRange(payment.date, range)) target.received += payment.amount;
	}

	// Darlehensraten per property and year, over the whole year: the interest of the year is
	// spread over them, so the window gets the share of the rates it holds.
	const ratesOfYear = new Map<string, number>();
	const key = (property: string | null, year: string) => `${property ?? ''}|${year}`;
	for (const expense of input.expenses) {
		if (expense.category !== 'loan_payment') continue;
		const year = key(expense.propertyId, expense.date.slice(0, 4));
		ratesOfYear.set(year, (ratesOfYear.get(year) ?? 0) + expense.amount);
	}
	const interestOfYear = new Map(
		input.interest.map((row) => [key(row.propertyId, String(row.year)), row.amount])
	);
	const ratio = (property: string | null, year: number) => {
		const interest = interestOfYear.get(key(property, String(year)));
		const paid = ratesOfYear.get(key(property, String(year))) ?? 0;
		return interest === undefined || paid <= 0 ? null : interest / paid;
	};
	/** The share of interest in the rates of a year: its own, or that of the latest year before. */
	const interestShare = (property: string | null, year: number) => {
		const own = ratio(property, year);
		if (own !== null) return { ratio: own, estimated: false };
		const earlier = input.interest
			.filter((row) => row.propertyId === property && row.year < year)
			.map((row) => row.year)
			.sort((a, b) => b - a)
			.find((candidate) => ratio(property, candidate) !== null);
		return earlier === undefined ? null : { ratio: ratio(property, earlier)!, estimated: true };
	};

	for (const expense of input.expenses) {
		if (!inRange(expense.date, range)) continue;
		if (propertyId && expense.propertyId !== propertyId) continue;
		const target = expense.propertyId ? flows.get(expense.propertyId) : unassigned;
		if (!target) continue;
		if (!loanCategories.includes(expense.category)) target.operating += expense.amount;
		else if (expense.category === 'loan_interest') target.interest += expense.amount;
		else if (expense.category === 'loan_repayment') target.repayment += expense.amount;
		else {
			const share = interestShare(expense.propertyId, Number(expense.date.slice(0, 4)));
			if (share === null) {
				target.unsplit += expense.amount;
			} else {
				const interest = Math.round(share.ratio * expense.amount);
				target.interest += interest;
				if (share.estimated) target.estimatedInterest += interest;
				target.repayment += expense.amount - interest;
			}
		}
	}

	const settle = (row: Flows) => {
		row.cashflow = row.received - row.operating - row.interest - row.repayment - row.unsplit;
	};

	const properties: PropertyReturns[] = inView.map((property) => {
		const row = flows.get(property.id)!;
		settle(row);
		const ownCapital =
			property.acquisitionCost !== null && property.loanAmount !== null
				? property.acquisitionCost - property.loanAmount
				: null;
		return {
			...property,
			...row,
			ownCapital,
			...(property.acquisitionCost === null
				? { gross: null, net: null, equity: null }
				: rates(row, property.acquisitionCost, ownCapital, months))
		};
	});

	const totals = emptyFlows();
	for (const row of properties) addFlows(totals, row);
	if (!propertyId) {
		settle(unassigned);
		addFlows(totals, unassigned);
	}

	const counted = properties.filter((row) => row.acquisitionCost !== null);
	const countedFlows = emptyFlows();
	for (const row of counted) addFlows(countedFlows, row);
	const acquisitionCost = counted.reduce((sum, row) => sum + row.acquisitionCost!, 0);
	// The return on equity of the portfolio only when every counted property has its loan.
	const ownCapital = counted.every((row) => row.loanAmount !== null)
		? counted.reduce((sum, row) => sum + row.ownCapital!, 0)
		: null;

	return {
		months,
		totals,
		rates: {
			counted: counted.length,
			acquisitionCost,
			ownCapital,
			...(counted.length
				? rates(countedFlows, acquisitionCost, ownCapital, months)
				: { gross: null, net: null, equity: null })
		},
		properties
	};
}
