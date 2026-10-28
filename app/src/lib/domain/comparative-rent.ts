import {
	addMonths,
	addMonthsToMonth,
	firstOfMonth,
	formatDate,
	lastOfMonth,
	monthOf,
	type IsoDate
} from '../dates';
import { formatArea } from '../format';
import { formatCents } from '../money';
import type { ComparisonSource } from '../server/db/schema';
import { greeting, formatPercent, type HistoryChange, type LetterTenant } from './index-rent';
import { rentOn, total, type RentChange } from './rents';

// Mieterhöhung bis zur ortsüblichen Vergleichsmiete (§§ 558–558b BGB): the pure part. The rent
// may rise once it has been unchanged for 15 months, the landlord may ask a year after the last
// increase at the earliest, the rent may not rise by more than the Kappungsgrenze in three years
// nor above the Vergleichsmiete, and the tenant has until the end of the second month after
// receiving the demand to consent; the new rent is due from the start of the third month.
// rent-adjustments.ts stores the demand and the consent.

/** § 558 Abs. 3 BGB: 20 %, or 15 % where a Land ordinance names the Gemeinde. */
export const cappingPercents = [20, 15] as const;
export type CappingPercent = (typeof cappingPercents)[number];

export type ComparativeLease = {
	kind: 'residential' | 'commercial' | 'parking';
	rentModel: 'fixed' | 'graduated' | 'indexed';
	/** The floor area of the unit in m², null when unknown. */
	floorArea: number | null;
};

/**
 * The first day of the latest approved change of the Kaltmiete, the lease start included.
 * § 560 changes after a statement only touch the prepayments and do not count. Undefined without
 * an approved change.
 */
export function lastBaseRentChange(changes: readonly HistoryChange[]): IsoDate | undefined {
	const approved = changes
		.filter((change) => change.status === 'approved' && change.reason !== 'statement')
		.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
	let previous: number | undefined;
	let last: IsoDate | undefined;
	for (const change of approved) {
		if (previous === undefined || change.baseRent !== previous) last = change.validFrom;
		previous = change.baseRent;
	}
	return last;
}

/** § 558b Abs. 2 BGB: the tenant may consent until the end of the second month after receipt. */
export function consentDeadline(deliveredOn: IsoDate): IsoDate {
	return lastOfMonth(addMonthsToMonth(monthOf(deliveredOn), 2));
}

/** § 558b Abs. 2 BGB: without consent, the landlord may sue within three further months. */
export function lawsuitDeadline(deliveredOn: IsoDate): IsoDate {
	return lastOfMonth(addMonthsToMonth(monthOf(deliveredOn), 5));
}

/**
 * The day the new rent is due: the start of the third month after receipt (§ 558b Abs. 1 BGB),
 * but not before the rent has been unchanged for 15 months (§ 558 Abs. 1 BGB).
 */
export function comparativeEffectiveFrom(deliveredOn: IsoDate, lastChange?: IsoDate): IsoDate {
	const due = firstOfMonth(addMonthsToMonth(monthOf(deliveredOn), 3));
	const unchanged = lastChange ? addMonths(lastChange, 15) : undefined;
	return unchanged && unchanged > due ? unchanged : due;
}

/**
 * The Kaltmiete the Kappungsgrenze starts from: the rent three years before the new one is due,
 * or the first rent of a younger lease.
 */
export function cappingBase(changes: readonly RentChange[], validFrom: IsoDate): number {
	const before = rentOn(changes, addMonths(validFrom, -36));
	if (before) return before.baseRent;
	const first = changes
		.filter((change) => change.status === 'approved')
		.sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];
	return first?.baseRent ?? 0;
}

/** The most the Kaltmiete may reach under the Kappungsgrenze, rounded down to a cent. */
export function cappedRent(base: number, percent: number): number {
	return Math.floor((base * (100 + percent)) / 100);
}

/** The Vergleichsmiete in cents per m² times the area, rounded down to a cent. */
export function comparisonLimit(comparativeRent: number, floorArea: number): number {
	return Math.floor(comparativeRent * floorArea);
}

/** Cents per m² of a Kaltmiete, rounded to a cent. */
export function perSquareMetre(baseRent: number, floorArea: number): number {
	return Math.round(baseRent / floorArea);
}

export type ComparativeSituation = {
	/** The first day of the latest change of the Kaltmiete. */
	lastChange: IsoDate | undefined;
	/** § 558 Abs. 1 Satz 2 BGB: the first day the demand may reach the tenant. */
	demandFrom: IsoDate | undefined;
	/** The day a demand that reaches the tenant on `deliveredOn` makes the new rent due. */
	validFrom: IsoDate;
	/** The Kaltmiete valid on validFrom (or the latest one). */
	currentBaseRent: number | undefined;
	capBase: number | undefined;
	/** The most the Kaltmiete may reach per Kappungsgrenze. */
	caps: Record<CappingPercent, number> | undefined;
	/** The demand waiting for the tenant's consent, if any. */
	pending: HistoryChange | undefined;
	/** Why no demand can be prepared, as a sentence for the page; undefined when it can. */
	refusal: string | undefined;
};

/** Everything the § 558 section and the demand need, for a demand reaching the tenant that day. */
export function comparativeSituation(
	lease: ComparativeLease,
	changes: readonly HistoryChange[],
	deliveredOn: IsoDate
): ComparativeSituation {
	const lastChange = lastBaseRentChange(changes);
	const demandFrom = lastChange ? addMonths(lastChange, 12) : undefined;
	const validFrom = comparativeEffectiveFrom(deliveredOn, lastChange);
	const current = rentOn(changes, validFrom) ?? rentOn(changes, '9999-12-31');
	const capBase = current ? cappingBase(changes, validFrom) : undefined;
	const caps =
		capBase !== undefined
			? { 20: cappedRent(capBase, 20), 15: cappedRent(capBase, 15) }
			: undefined;
	const pending = changes.find((change) => change.status === 'proposed');

	let refusal: string | undefined;
	if (lease.kind !== 'residential')
		refusal = 'Eine Erhöhung bis zur Vergleichsmiete (§ 558 BGB) gibt es nur bei Wohnraum.';
	else if (lease.rentModel !== 'fixed')
		refusal =
			lease.rentModel === 'graduated'
				? 'Bei einer Staffelmiete ist eine Erhöhung nach § 558 BGB ausgeschlossen (§ 557a Abs. 2 BGB).'
				: 'Bei einer Indexmiete ist eine Erhöhung nach § 558 BGB ausgeschlossen (§ 557b Abs. 2 BGB).';
	else if (pending)
		refusal =
			'Es gibt schon ein Erhöhungsverlangen. Trag die Zustimmung ein oder lösche es in der Tabelle.';
	else if (!current) refusal = 'Dem Mietvertrag fehlt die Miete.';
	else if (!lease.floorArea)
		refusal =
			'Für die Einheit fehlt die Wohnfläche. Die Vergleichsmiete gilt je Quadratmeter; trag die Fläche zuerst ein.';

	return {
		lastChange,
		demandFrom,
		validFrom,
		currentBaseRent: current?.baseRent,
		capBase,
		caps,
		pending,
		refusal
	};
}

export type ComparativeDemand = {
	deliveredOn: IsoDate;
	baseRent: number;
	/** Cents per m². */
	comparativeRent: number;
	cappingPercent: CappingPercent;
	comparisonSource: ComparisonSource;
	comparisonDetails: string;
};

/**
 * The checks of a demand against the situation for its delivery date: a field and a German
 * sentence for the first rule it breaks, undefined when it keeps all of them.
 */
export function demandProblem(
	lease: ComparativeLease,
	situation: ComparativeSituation,
	demand: ComparativeDemand
): { field: keyof ComparativeDemand; message: string } | undefined {
	const current = situation.currentBaseRent!;
	const area = lease.floorArea!;
	if (situation.demandFrom && demand.deliveredOn < situation.demandFrom) {
		return {
			field: 'deliveredOn',
			message: `Die Kaltmiete wurde zuletzt zum ${formatDate(situation.lastChange!)} geändert. Eine Erhöhung darf frühestens ein Jahr danach verlangt werden, also ab dem ${formatDate(situation.demandFrom)} (§ 558 Abs. 1 BGB).`
		};
	}
	if (demand.baseRent <= current) {
		return {
			field: 'baseRent',
			message: `Die neue Kaltmiete muss über der bisherigen von ${formatCents(current)} liegen.`
		};
	}
	const cap = cappedRent(situation.capBase!, demand.cappingPercent);
	if (demand.baseRent > cap) {
		return {
			field: 'baseRent',
			message: `Die Kappungsgrenze von ${demand.cappingPercent} % erlaubt höchstens ${formatCents(cap)} (${formatCents(situation.capBase!)} drei Jahre vor dem ${formatDate(situation.validFrom)}, § 558 Abs. 3 BGB).`
		};
	}
	const limit = comparisonLimit(demand.comparativeRent, area);
	if (demand.baseRent > limit) {
		return {
			field: 'baseRent',
			message: `Die Vergleichsmiete von ${formatCents(demand.comparativeRent)} je m² erlaubt bei ${formatArea(area)} höchstens ${formatCents(limit)}.`
		};
	}
	return undefined;
}

export const comparisonSourceSentences: Record<ComparisonSource, string> = {
	rent_index: 'Sie ergibt sich aus dem Mietspiegel',
	rent_database: 'Sie ergibt sich aus der Auskunft aus der Mietdatenbank',
	expert_opinion: 'Sie ergibt sich aus dem beigefügten Gutachten eines Sachverständigen',
	comparable_flats: 'Vergleichbare Wohnungen mit mindestens dieser Miete sind'
};

export type ComparativeLetterContent = {
	unitName: string;
	floorArea: number;
	tenants: readonly LetterTenant[];
	oldRent: RentChange;
	newRent: RentChange;
	capBase: number;
	lastChange: IsoDate;
	deliveredOn: IsoDate;
	demand: ComparativeDemand;
};

/** The paragraphs of the demand, separated by blank lines; stored in letterText. */
export function comparativeLetterText(content: ComparativeLetterContent): string {
	const { demand, oldRent, newRent, floorArea } = content;
	const increase = newRent.baseRent - oldRent.baseRent;
	const percent = Math.round((newRent.baseRent / content.capBase - 1) * 10_000) / 100;
	const details = demand.comparisonDetails.trim().replace(/[.:]$/, '');
	const paragraphs = [
		greeting(content.tenants),
		`Wir bitten Sie, für Ihre Wohnung ${content.unitName} einer Erhöhung der Kaltmiete nach ` +
			`§ 558 BGB von ${formatCents(oldRent.baseRent)} um ${formatCents(increase)} auf ` +
			`${formatCents(newRent.baseRent)} im Monat zuzustimmen.`,
		`Die ortsübliche Vergleichsmiete für Wohnungen dieser Art, Größe, Ausstattung, Beschaffenheit ` +
			`und Lage beträgt ${formatCents(demand.comparativeRent)} je m². ` +
			`${comparisonSourceSentences[demand.comparisonSource]}: ${details}. Bei ${formatArea(floorArea)} ` +
			`Wohnfläche steigt die Kaltmiete von ${formatCents(perSquareMetre(oldRent.baseRent, floorArea))} ` +
			`auf ${formatCents(perSquareMetre(newRent.baseRent, floorArea))} je m² und liegt damit nicht ` +
			'über der ortsüblichen Vergleichsmiete.',
		`Die Kaltmiete ist seit dem ${formatDate(content.lastChange)} unverändert. Gegenüber der Miete ` +
			`vor drei Jahren (${formatCents(content.capBase)}) steigt sie um ${formatPercent(percent)} und ` +
			`bleibt innerhalb der Kappungsgrenze von ${demand.cappingPercent}\u00a0% (§ 558 Abs. 3 BGB).`,
		`Bitte stimmen Sie der Erhöhung bis zum ${formatDate(consentDeadline(content.deliveredOn))} ` +
			`in Textform zu. Die neue Miete ist dann ab dem ${formatDate(newRent.validFrom)} zu zahlen. ` +
			`Die Vorauszahlungen für Betriebskosten (${formatCents(newRent.operatingCostPrepayment)}) und ` +
			`Heizkosten (${formatCents(newRent.heatingCostPrepayment)}) bleiben unverändert; die ` +
			`Gesamtmiete beträgt dann ${formatCents(total(newRent))} im Monat.`
	];
	return paragraphs.join('\n\n');
}

/** The rows of the old/new table under the demand: Kaltmiete, per m², Gesamtmiete. */
export function comparativeLetterRows(content: ComparativeLetterContent): string[][] {
	const { oldRent, newRent, floorArea } = content;
	return [
		['Kaltmiete', formatCents(oldRent.baseRent), formatCents(newRent.baseRent)],
		[
			'Kaltmiete je m²',
			formatCents(perSquareMetre(oldRent.baseRent, floorArea)),
			formatCents(perSquareMetre(newRent.baseRent, floorArea))
		],
		['Gesamtmiete', formatCents(total(oldRent)), formatCents(total(newRent))]
	];
}
