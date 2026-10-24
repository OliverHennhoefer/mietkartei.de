import { formatNumber } from '../format';
import { formatCents as money } from '../money';
import type { ExpenseCategory, RentChargeKind } from '../server/db/schema';
import type { UnitKind } from '../units';

// Die Steuerübersicht: what one property brought in and cost in a calendar year, sorted into the
// lines of the Anlage V (Einkünfte aus Vermietung und Verpachtung). Pure: the server module loads
// the rows, this computes every figure. Income and costs count in the year the money moved
// (Zufluss- und Abflussprinzip, § 11 EStG); the AfA spreads the building over its useful life.
// It is an aid for the landlord and their Steuerberater, not tax advice.

/** The form the line numbers follow; other years number some lines differently. */
export const FORM_YEAR = 2025;

/** Lines of the Anlage V 2025. */
export const taxLines = {
	apartments: { line: 15, label: 'Mieteinnahmen für Wohnungen (ohne Umlagen)' },
	otherRooms: { line: 18, label: 'Mieteinnahmen für andere Räume (ohne Umlagen)' },
	prepayments: { line: 20, label: 'Umlagen: laufende Neben- und Betriebskosten' },
	settlements: { line: 21, label: 'Umlagen: Nachzahlungen und Erstattungen' },
	parking: { line: 26, label: 'Einnahmen aus Garagen und Stellplätzen' },
	otherIncome: { line: 29, label: 'Sonstige Einnahmen' },
	depreciation: { line: 33, label: 'AfA Gebäude' },
	interest: { line: 46, label: 'Schuldzinsen' },
	maintenance: { line: 55, label: 'Erhaltungsaufwendungen, voll abzuziehen' },
	allocatedCosts: { line: 73, label: 'Umgelegte Kosten' },
	unallocatedCosts: { line: 76, label: 'Nicht umgelegte Kosten' },
	otherCosts: { line: 80, label: 'Sonstige Kosten' }
} as const;

export type TaxLineKey = keyof typeof taxLines;

export const incomeLineKeys = [
	'apartments',
	'otherRooms',
	'prepayments',
	'settlements',
	'parking',
	'otherIncome'
] as const satisfies readonly TaxLineKey[];

export const costLineKeys = [
	'depreciation',
	'interest',
	'maintenance',
	'allocatedCosts',
	'unallocatedCosts',
	'otherCosts'
] as const satisfies readonly TaxLineKey[];

export type TaxProperty = {
	kind: 'building' | 'condominium';
	acquisitionDate: string | null;
	/** Anschaffungskosten in cents: price plus Nebenkosten. */
	acquisitionCost: number | null;
	/** Percent of the cost that is the building. */
	buildingShare: number | null;
	/** Percent per year. */
	depreciationRate: number | null;
};

export type TaxUnit = { id: string; kind: UnitKind };

export type TaxLease = { id: string; unitId: string };

export type TaxCharge = {
	leaseId: string;
	period: string;
	kind: RentChargeKind;
	baseRent: number;
	operatingCostPrepayment: number;
	heatingCostPrepayment: number;
	amount: number;
};

export type TaxPayment = { leaseId: string; date: string; amount: number };

export type TaxExpense = {
	id: string;
	date: string;
	amount: number;
	category: ExpenseCategory;
	description: string;
};

export type TaxAssociationStatement = {
	periodStart: string;
	allocableCosts: number;
	nonAllocableCosts: number;
	reserveContribution: number;
	reserveWithdrawal: number;
};

export type TaxInput = {
	year: number;
	property: TaxProperty;
	units: readonly TaxUnit[];
	/** The leases whose main unit belongs to the property. */
	leases: readonly TaxLease[];
	charges: readonly TaxCharge[];
	payments: readonly TaxPayment[];
	/** Every expense of the property and its units, of all years (for the 15 % check). */
	expenses: readonly TaxExpense[];
	associationStatements: readonly TaxAssociationStatement[];
	/** Schuldzinsen of the year from the Zinsbescheinigung; null = not entered. */
	loanInterest: number | null;
};

/** One amount on a line, with where it comes from. */
export type TaxEntry = { label: string; amount: number };

export type TaxLine = {
	key: TaxLineKey;
	line: number;
	label: string;
	amount: number;
	entries: TaxEntry[];
};

/** What a lease paid in the year and how it was split over the lines. */
export type TaxLeaseIncome = {
	leaseId: string;
	unitKind: UnitKind;
	/** Money received in the year. */
	received: number;
	/** The charges of the year's months. */
	charged: number;
	baseRent: number;
	prepayments: number;
	settlements: number;
	other: number;
	/** Received differs from charged, so the split is proportional. */
	prorated: boolean;
};

export type TaxDepreciation = {
	/** Anschaffungskosten of the building alone. */
	base: number;
	/** AfA of a full year. */
	yearly: number;
	/** Months of the year that count. */
	months: number;
	amount: number;
	/** What is left to depreciate after this year. */
	remaining: number;
};

export type TaxNonDeductible = { label: string; amount: number; reason: string };

export type TaxFindingCode =
	| 'depreciation-missing'
	| 'interest-missing'
	| 'association-missing'
	| 'prorated'
	| 'acquisition-related';

export type TaxFinding = { code: TaxFindingCode; message: string };

export type TaxOverview = {
	year: number;
	income: TaxLine[];
	costs: TaxLine[];
	incomeTotal: number;
	costsTotal: number;
	/** Überschuss: income less costs; negative is a loss. */
	result: number;
	leases: TaxLeaseIncome[];
	depreciation: TaxDepreciation | null;
	nonDeductible: TaxNonDeductible[];
	findings: TaxFinding[];
};

const inYear = (date: string, year: number) => date.slice(0, 4) === String(year);

/** The share `part / whole` of `amount`, rounded to cents; 0 when the whole is 0. */
function share(amount: number, part: number, whole: number): number {
	return whole === 0 ? 0 : Math.round((amount * part) / whole);
}

/**
 * The AfA of the building for `year`: Anschaffungskosten × Gebäudeanteil × rate, in the year of
 * acquisition only for its months from the month of acquisition on (§ 7 Abs. 1 Satz 4 EStG), and
 * never more than is left. Null without the figures it needs.
 */
export function depreciationFor(property: TaxProperty, year: number): TaxDepreciation | null {
	const { acquisitionDate, acquisitionCost, buildingShare, depreciationRate } = property;
	if (!acquisitionDate || !acquisitionCost || !buildingShare || !depreciationRate) return null;
	const base = Math.round((acquisitionCost * buildingShare) / 100);
	const yearly = Math.round((base * depreciationRate) / 100);
	const firstYear = Number(acquisitionDate.slice(0, 4));
	const firstMonths = 13 - Number(acquisitionDate.slice(5, 7));
	let remaining = base;
	for (let current = firstYear; current <= year; current++) {
		const months = current === firstYear ? firstMonths : 12;
		const amount = Math.min(remaining, Math.round((yearly * months) / 12));
		remaining -= amount;
		if (current === year) return { base, yearly, months, amount, remaining };
	}
	return { base, yearly, months: 0, amount: 0, remaining };
}

/** The line a lease's Kaltmiete goes on, by the kind of its main unit. */
function rentLine(kind: UnitKind): TaxLineKey {
	if (kind === 'commercial') return 'otherRooms';
	if (kind === 'parking') return 'parking';
	return 'apartments';
}

/** What each lease paid in the year, split like the charges of the year's months. */
function leaseIncome(input: TaxInput): TaxLeaseIncome[] {
	const unitKind = new Map(input.units.map((unit) => [unit.id, unit.kind]));
	return input.leases.flatMap((lease): TaxLeaseIncome[] => {
		let baseRent = 0;
		let prepayments = 0;
		let settlements = 0;
		let other = 0;
		for (const charge of input.charges) {
			if (charge.leaseId !== lease.id || !inYear(charge.period, input.year)) continue;
			if (charge.kind === 'rent') {
				baseRent += charge.baseRent;
				prepayments += charge.amount - charge.baseRent;
			} else if (charge.kind === 'adjustment') {
				other += charge.amount;
			} else {
				// A statement's Nachzahlung or Guthaben, or the landlord's CO₂ share credited back.
				settlements += charge.amount;
			}
		}
		const received = input.payments
			.filter((payment) => payment.leaseId === lease.id && inYear(payment.date, input.year))
			.reduce((sum, payment) => sum + payment.amount, 0);
		const charged = baseRent + prepayments + settlements + other;
		if (received === 0 && charged === 0) return [];
		const kind = unitKind.get(lease.unitId) ?? 'apartment';
		const row = { leaseId: lease.id, unitKind: kind, received, charged };
		if (received === charged) {
			return [{ ...row, baseRent, prepayments, settlements, other, prorated: false }];
		}
		if (charged === 0) {
			// Money without a charge of the year: back rent, or a Guthaben paid out.
			return [
				{
					...row,
					baseRent: received > 0 ? received : 0,
					prepayments: 0,
					settlements: received < 0 ? received : 0,
					other: 0,
					prorated: true
				}
			];
		}
		const split = {
			baseRent: share(received, baseRent, charged),
			prepayments: share(received, prepayments, charged),
			settlements: share(received, settlements, charged)
		};
		return [
			{
				...row,
				...split,
				other: received - split.baseRent - split.prepayments - split.settlements,
				prorated: true
			}
		];
	});
}

export function taxOverview(input: TaxInput): TaxOverview {
	const { year } = input;
	const amounts = new Map<TaxLineKey, TaxEntry[]>();
	const add = (key: TaxLineKey, label: string, amount: number) => {
		if (amount === 0) return;
		const list = amounts.get(key);
		if (list) list.push({ label, amount });
		else amounts.set(key, [{ label, amount }]);
	};
	const nonDeductible: TaxNonDeductible[] = [];
	const findings: TaxFinding[] = [];

	// Income.
	const leases = leaseIncome(input);
	const kindLabel = { apartment: 'Wohnungen', commercial: 'Gewerbe', parking: 'Stellplätze' };
	for (const kind of ['apartment', 'commercial', 'parking'] as const) {
		const own = leases.filter((lease) => lease.unitKind === kind);
		add(
			rentLine(kind),
			`Kaltmiete ${kindLabel[kind]}`,
			own.reduce((sum, lease) => sum + lease.baseRent, 0)
		);
	}
	add(
		'prepayments',
		'Vorauszahlungen auf Betriebs- und Heizkosten',
		leases.reduce((sum, lease) => sum + lease.prepayments, 0)
	);
	add(
		'settlements',
		'Nachzahlungen und Guthaben aus Betriebskostenabrechnungen',
		leases.reduce((sum, lease) => sum + lease.settlements, 0)
	);
	add(
		'otherIncome',
		'Weitere Sollstellungen im Mietkonto',
		leases.reduce((sum, lease) => sum + lease.other, 0)
	);
	const prorated = leases.filter((lease) => lease.prorated);
	if (prorated.length > 0) {
		findings.push({
			code: 'prorated',
			message: `Bei ${prorated.length === 1 ? 'einem Mietvertrag' : `${prorated.length} Mietverträgen`} weichen die Zahlungen ${year} von den Sollstellungen ab. Die Einnahmen sind deshalb anteilig auf Kaltmiete und Umlagen verteilt. Nachzahlungen für frühere Jahre gehören in Zeile 25.`
		});
	}

	// Costs, by category.
	const expenses = input.expenses.filter((expense) => inYear(expense.date, year));
	const sum = (category: ExpenseCategory) =>
		expenses
			.filter((expense) => expense.category === category)
			.reduce((total, expense) => total + expense.amount, 0);

	const depreciation = depreciationFor(input.property, year);
	if (depreciation) {
		add(
			'depreciation',
			`${formatNumber(input.property.depreciationRate!)} % von ${money(depreciation.base)}${depreciation.months < 12 ? `, ${depreciation.months} Monate` : ''}`,
			depreciation.amount
		);
	} else {
		findings.push({
			code: 'depreciation-missing',
			message:
				'Ohne Kaufdatum, Anschaffungskosten, Gebäudeanteil und AfA-Satz fehlt die Abschreibung des Gebäudes.'
		});
	}

	add('interest', 'Darlehenszinsen', sum('loan_interest'));
	const loanPayments = sum('loan_payment');
	if (input.loanInterest !== null) {
		add('interest', 'Zinsen laut Zinsbescheinigung', input.loanInterest);
		if (loanPayments !== 0) {
			nonDeductible.push({
				label: 'Tilgung in den Darlehensraten',
				amount: loanPayments - input.loanInterest,
				reason: 'Darlehensraten abzüglich der Zinsen laut Zinsbescheinigung'
			});
		}
	} else if (loanPayments !== 0) {
		nonDeductible.push({
			label: 'Darlehensraten',
			amount: loanPayments,
			reason: 'Die Zinsen daraus zählen erst, wenn du sie laut Zinsbescheinigung einträgst'
		});
		findings.push({
			code: 'interest-missing',
			message: `${year} sind Darlehensraten über ${money(loanPayments)} gebucht. Trag die Zinsen laut Zinsbescheinigung der Bank ein, sonst fehlen sie in Zeile 46.`
		});
	}
	const repayment = sum('loan_repayment');
	if (repayment !== 0) {
		nonDeductible.push({
			label: 'Tilgung',
			amount: repayment,
			reason: 'Tilgung mindert das Darlehen und ist kein Aufwand'
		});
	}

	add('maintenance', 'Instandhaltung und Reparaturen', sum('maintenance'));
	add('maintenance', 'Sonderumlagen für Erhaltung', sum('special_levy'));
	const levyReserve = sum('special_levy_reserve');
	if (levyReserve !== 0) {
		nonDeductible.push({
			label: 'Sonderumlagen in die Rücklage',
			amount: levyReserve,
			reason: 'Zählen erst, wenn der Verwalter das Geld für eine Maßnahme ausgibt'
		});
	}
	const modernization = sum('modernization');
	if (modernization !== 0) {
		nonDeductible.push({
			label: 'Modernisierung und Anschaffungen',
			amount: modernization,
			reason: 'Herstellungs- oder Anschaffungskosten, über die AfA abzuschreiben'
		});
	}

	add('allocatedCosts', 'Betriebskosten', sum('operating_costs'));
	add('unallocatedCosts', 'Verwaltung, Beratung und Gebühren', sum('management'));
	add('otherCosts', 'Sonstiges', sum('other'));

	// Hausgeld: what was paid less the Zuführung zur Rücklage, split like the Verwalter's costs;
	// what the Verwalter spent from the reserve counts as Erhaltung.
	const fees = sum('association_fee');
	const statement = input.associationStatements.find((row) => inYear(row.periodStart, year));
	if (statement) {
		const deductible = fees - statement.reserveContribution;
		const allocated = share(
			deductible,
			statement.allocableCosts,
			statement.allocableCosts + statement.nonAllocableCosts
		);
		add('allocatedCosts', 'Hausgeld, umlagefähiger Anteil', allocated);
		add('unallocatedCosts', 'Hausgeld, nicht umlagefähiger Anteil', deductible - allocated);
		add('maintenance', 'Entnahme aus der Erhaltungsrücklage', statement.reserveWithdrawal);
		if (statement.reserveContribution !== 0) {
			nonDeductible.push({
				label: 'Zuführung zur Erhaltungsrücklage',
				amount: statement.reserveContribution,
				reason: 'Zählt erst, wenn der Verwalter das Geld ausgibt'
			});
		}
	} else if (fees !== 0) {
		add('unallocatedCosts', 'Hausgeld', fees);
		findings.push({
			code: 'association-missing',
			message: `Für ${year} ist keine Hausgeldabrechnung erfasst. Das gezahlte Hausgeld steht deshalb voll in Zeile 76, ohne die Zuführung zur Erhaltungsrücklage abzuziehen und ohne Aufteilung in umgelegte und nicht umgelegte Kosten.`
		});
	}

	// Anschaffungsnahe Herstellungskosten (§ 6 Abs. 1 Nr. 1a EStG): repairs and modernisation in the
	// first three years after the purchase above 15 % of the building's cost become part of it.
	if (depreciation && input.property.acquisitionDate) {
		const start = input.property.acquisitionDate;
		const end = `${Number(start.slice(0, 4)) + 3}${start.slice(4)}`;
		if (year >= Number(start.slice(0, 4)) && year <= Number(end.slice(0, 4))) {
			const works = input.expenses
				.filter(
					(expense) =>
						expense.date >= start &&
						expense.date < end &&
						(expense.category === 'maintenance' ||
							expense.category === 'modernization' ||
							expense.category === 'special_levy')
				)
				.reduce((total, expense) => total + expense.amount, 0);
			const limit = Math.round(depreciation.base * 0.15);
			if (works > limit) {
				findings.push({
					code: 'acquisition-related',
					message: `In den ersten drei Jahren nach dem Kauf sind Instandhaltung und Modernisierung über ${money(works)} gebucht, mehr als 15 % des Gebäudeanteils (${money(limit)}). Solche Kosten zählen meist als anschaffungsnahe Herstellungskosten und werden über die AfA abgeschrieben statt sofort abgezogen. Lass das von deinem Steuerberater prüfen.`
				});
			}
		}
	}

	const lines = (keys: readonly TaxLineKey[]): TaxLine[] =>
		keys.flatMap((key) => {
			const entries = amounts.get(key);
			if (!entries) return [];
			return [
				{
					key,
					...taxLines[key],
					amount: entries.reduce((total, entry) => total + entry.amount, 0),
					entries
				}
			];
		});
	const income = lines(incomeLineKeys);
	const costs = lines(costLineKeys);
	const incomeTotal = income.reduce((total, line) => total + line.amount, 0);
	const costsTotal = costs.reduce((total, line) => total + line.amount, 0);
	return {
		year,
		income,
		costs,
		incomeTotal,
		costsTotal,
		result: incomeTotal - costsTotal,
		leases,
		depreciation,
		nonDeductible,
		findings
	};
}
