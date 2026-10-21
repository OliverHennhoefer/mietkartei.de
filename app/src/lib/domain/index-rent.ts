import {
	addDays,
	addMonths,
	addMonthsToMonth,
	firstOfMonth,
	formatDate,
	formatMonth,
	monthOf,
	type IsoDate,
	type IsoMonth
} from '../dates';
import { formatCents, proRata } from '../money';
import type { RentChangeReason } from '../server/db/schema';
import { rentOn, total, type RentChange } from './rents';

// Index rent (§ 557b BGB) and graduated rent (§ 557a BGB): the pure part of the rent feature.
// The reference index, the proposal, the waiting periods and the letter text are computed here
// from the rent history and the VPI table; rent-adjustments.ts stores the results.

/** A VPI reading: the month it was published for and its value (base year = 100). */
export type IndexPoint = { month: IsoMonth; value: number };

export type IndexValueRow = IndexPoint & { baseYear: string };

/** The columns of a rent change this module reads. */
export type HistoryChange = RentChange & {
	reason: RentChangeReason;
	indexMonth: string | null;
	indexValue: number | null;
	indexBaseYear: string;
};

export type IndexBase = {
	indexBaseMonth: string | null;
	indexBaseValue: number | null;
	indexBaseYear: string;
};

export type IndexProposal = {
	currentBaseRent: number;
	/** current × latest ÷ reference, rounded half-up to a cent. */
	newBaseRent: number;
	/** newBaseRent − currentBaseRent; negative when the index fell. */
	increase: number;
	/** The index change in percent, two decimals. */
	percent: number;
	reference: IndexPoint;
	latest: IndexPoint;
};

const indexFormat = new Intl.NumberFormat('de-DE', {
	minimumFractionDigits: 1,
	maximumFractionDigits: 1
});

const percentFormat = new Intl.NumberFormat('de-DE', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

/** `118.2` → `118,2`. */
export function formatIndexValue(value: number): string {
	return indexFormat.format(value);
}

/** `5.16` → `5,16 %`. */
export function formatPercent(value: number): string {
	return `${percentFormat.format(value)}\u00a0%`;
}

function byValidFrom(a: { validFrom: IsoDate }, b: { validFrom: IsoDate }): number {
	return a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0;
}

/**
 * The index the rent valid on `date` is based on: the index of the latest approved change on or
 * before that day that carries one (an approved index adjustment, or a manual change on an
 * indexed lease), else the lease's base index; undefined when the lease has none. A change
 * scheduled after `date` is ignored, as it is by rentOn, so rent and reference always match.
 */
export function referenceIndex(
	changes: readonly HistoryChange[],
	lease: IndexBase,
	date: IsoDate
): IndexValueRow | undefined {
	let found: HistoryChange | undefined;
	for (const change of changes) {
		if (change.status !== 'approved' || change.validFrom > date) continue;
		if (!change.indexMonth || change.indexValue === null) continue;
		if (!found || change.validFrom >= found.validFrom) found = change;
	}
	if (found) {
		return { month: found.indexMonth!, value: found.indexValue!, baseYear: found.indexBaseYear };
	}
	if (lease.indexBaseMonth && lease.indexBaseValue !== null && lease.indexBaseValue > 0) {
		return {
			month: lease.indexBaseMonth,
			value: lease.indexBaseValue,
			baseYear: lease.indexBaseYear
		};
	}
	return undefined;
}

export type LatestIndex =
	| { ok: true; latest: IndexValueRow }
	| { ok: false; reason: 'none' }
	| { ok: false; reason: 'mixed'; baseYears: string[] };

/**
 * The newest VPI value of the account. Values of different base years cannot be compared, so a
 * table with more than one base year is refused; the page asks for the rebased value instead.
 */
export function latestIndex(values: readonly IndexValueRow[]): LatestIndex {
	if (values.length === 0) return { ok: false, reason: 'none' };
	const baseYears = [...new Set(values.map((value) => value.baseYear))].sort();
	if (baseYears.length > 1) return { ok: false, reason: 'mixed', baseYears };
	let latest = values[0];
	for (const value of values) if (value.month > latest.month) latest = value;
	return { ok: true, latest };
}

/**
 * New base rent = current × latest ÷ reference, rounded half-up to a cent. The index values are
 * scaled to integers first, so the division is exact up to the rounding.
 */
export function indexProposal(
	currentBaseRent: number,
	reference: IndexPoint,
	latest: IndexPoint
): IndexProposal {
	const scale = 1000;
	const newBaseRent = proRata(
		currentBaseRent,
		Math.round(latest.value * scale),
		Math.round(reference.value * scale)
	);
	const percent = Math.round((latest.value / reference.value - 1) * 10_000) / 100;
	return {
		currentBaseRent,
		newBaseRent,
		increase: newBaseRent - currentBaseRent,
		percent,
		reference,
		latest
	};
}

/** § 557b Abs. 3 BGB: the new rent is due from the first day of the second month after delivery. */
export function effectiveFrom(deliveredOn: IsoDate): IsoDate {
	return firstOfMonth(addMonthsToMonth(monthOf(deliveredOn), 2));
}

/**
 * § 557b Abs. 2 BGB: the rent must stay unchanged for a year. Returns the day the year after the
 * latest approved base rent change ends: the first day the next adjustment may take effect.
 * Changes after a statement (§ 560) only touch the prepayments and are ignored; the lease start
 * counts as the first change. Undefined without an approved change.
 */
export function waitingPeriodEnd(changes: readonly HistoryChange[]): IsoDate | undefined {
	const approved = changes
		.filter((change) => change.status === 'approved' && change.reason !== 'statement')
		.sort(byValidFrom);
	let previous: number | undefined;
	let last: IsoDate | undefined;
	for (const change of approved) {
		if (previous === undefined || change.baseRent !== previous) last = change.validFrom;
		previous = change.baseRent;
	}
	return last ? addMonths(last, 12) : undefined;
}

/**
 * § 557a Abs. 2 BGB: at least one year between the steps of a graduated rent. The previous step
 * is the latest approved step, the lease start counting as the first. Undefined without one.
 */
export function nextGraduatedStepAllowed(changes: readonly HistoryChange[]): IsoDate | undefined {
	let last: IsoDate | undefined;
	for (const change of changes) {
		if (change.status !== 'approved') continue;
		if (change.reason !== 'initial' && change.reason !== 'graduated') continue;
		if (!last || change.validFrom > last) last = change.validFrom;
	}
	return last ? addMonths(last, 12) : undefined;
}

export type IndexLease = IndexBase & {
	kind: 'residential' | 'commercial' | 'parking';
	rentModel: 'fixed' | 'graduated' | 'indexed';
};

export type IndexSituation = {
	reference: IndexValueRow | undefined;
	latest: LatestIndex;
	/** The first day a new rent may take effect; residential leases only. */
	waitingUntil: IsoDate | undefined;
	/** The provisional effective date of a proposal made today. */
	provisionalFrom: IsoDate;
	/** The change waiting for approval, if any. */
	pending: HistoryChange | undefined;
	/** Computed whenever reference and latest exist, even when a proposal is refused. */
	proposal: IndexProposal | undefined;
	/** Why no proposal can be made right now, as a sentence for the page; undefined when it can. */
	refusal: string | undefined;
};

/** Everything the Indexmiete section and proposeIndexChange need, computed once. */
export function indexSituation(
	lease: IndexLease,
	changes: readonly HistoryChange[],
	values: readonly IndexValueRow[],
	today: IsoDate
): IndexSituation {
	const latest = latestIndex(values);
	const waitingUntil = lease.kind === 'residential' ? waitingPeriodEnd(changes) : undefined;
	const provisionalFrom = effectiveFrom(today);
	const pending = changes.find((change) => change.status === 'proposed');
	// The rent and the reference index the proposal replaces, both as of the day it takes effect,
	// so a change scheduled after that day supplies neither. A lease that starts later is taken
	// as of its last change.
	const current = rentOn(changes, provisionalFrom) ?? rentOn(changes, '9999-12-31');
	const basisDate =
		current && current.validFrom > provisionalFrom ? current.validFrom : provisionalFrom;
	const reference = referenceIndex(changes, lease, basisDate);
	const sameBase = !reference || !latest.ok || reference.baseYear === latest.latest.baseYear;
	const proposal =
		reference && latest.ok && sameBase && current
			? indexProposal(current.baseRent, reference, latest.latest)
			: undefined;

	let refusal: string | undefined;
	if (lease.rentModel !== 'indexed') refusal = 'Dieser Mietvertrag hat keine Indexmiete.';
	else if (pending) refusal = 'Es gibt schon einen Vorschlag. Gib ihn frei oder lösche ihn.';
	else if (!reference)
		refusal = 'Dem Mietvertrag fehlt der Bezugsindex (Basismonat und Indexwert).';
	else if (!latest.ok && latest.reason === 'none')
		refusal = 'Es sind noch keine Werte des Verbraucherpreisindex eingetragen.';
	else if (!latest.ok)
		refusal =
			`Die VPI-Tabelle enthält Werte mit mehreren Basisjahren (${latest.baseYears.join(', ')}). ` +
			'Trage den aktuellen Wert auf das Basisjahr des Bezugsindex umgerechnet ein.';
	else if (!sameBase)
		refusal =
			`Der Bezugsindex beruht auf dem Basisjahr ${reference.baseYear}, die VPI-Werte auf dem ` +
			`Basisjahr ${latest.latest.baseYear}. Trage die VPI-Werte zum Basisjahr ` +
			`${reference.baseYear} ein oder den Bezugsindex umgerechnet im Mietvertrag.`;
	else if (!current) refusal = 'Dem Mietvertrag fehlt die aktuelle Miete.';
	else if (latest.latest.month <= reference.month)
		refusal =
			`Der neueste VPI-Wert (${formatMonth(latest.latest.month)}) ist nicht neuer als der ` +
			`Bezugsindex (${formatMonth(reference.month)}).`;
	else if (proposal && proposal.increase <= 0)
		refusal =
			'Der Index ist seit dem Bezugsmonat nicht gestiegen; eine Erhöhung ergibt sich nicht.';
	else if (waitingUntil && provisionalFrom < waitingUntil)
		refusal =
			'Die Miete muss mindestens ein Jahr unverändert bleiben (§ 557b Abs. 2 BGB); ' +
			`eine Anpassung kann frühestens zum ${formatDate(waitingUntil)} wirksam werden.`;

	return { reference, latest, waitingUntil, provisionalFrom, pending, proposal, refusal };
}

export type LetterTenant = {
	salutation: string | null;
	firstName: string;
	lastName: string;
};

/**
 * "Guten Tag Frau Muster, Herr Beispiel," or "Guten Tag Erika Muster,": the letters to tenants
 * use the informal register of the app ("du"), as the statement letter does, so the greeting is
 * not the formal "Sehr geehrte".
 */
export function greeting(tenants: readonly LetterTenant[]): string {
	const names = tenants.map((tenant) => {
		const salutation = (tenant.salutation ?? '').trim();
		if (salutation === 'Frau' || salutation === 'Herr') return `${salutation} ${tenant.lastName}`;
		return `${tenant.firstName} ${tenant.lastName}`.trim();
	});
	return names.length > 0 ? `Guten Tag ${names.join(', ')},` : 'Guten Tag,';
}

export type LetterFigures = {
	reference: IndexPoint;
	latest: IndexPoint;
	percent: number;
	oldRent: RentChange;
	newRent: RentChange;
	validFrom: IsoDate;
	baseYear: string;
};

/**
 * The figures of an index letter: the rent and the reference index the approved change replaces,
 * taken from the history before its validFrom, so the letter and the PDF table agree. Undefined
 * when the change carries no index, the history has no rent before it or the reference has
 * another base year.
 */
export function letterFigures(
	changes: readonly HistoryChange[],
	lease: IndexBase,
	change: HistoryChange
): LetterFigures | undefined {
	if (!change.indexMonth || change.indexValue === null) return undefined;
	const before = changes.filter((other) => other !== change && other.validFrom < change.validFrom);
	const dayBefore = addDays(change.validFrom, -1);
	const oldRent = rentOn(before, dayBefore);
	const reference = referenceIndex(before, lease, dayBefore);
	if (!oldRent || !reference || reference.baseYear !== change.indexBaseYear) return undefined;
	const latest = { month: change.indexMonth, value: change.indexValue };
	return {
		reference,
		latest,
		percent: indexProposal(oldRent.baseRent, reference, latest).percent,
		oldRent,
		newRent: change,
		validFrom: change.validFrom,
		baseYear: change.indexBaseYear
	};
}

export type LetterContent = {
	unitName: string;
	tenants: readonly LetterTenant[];
	figures: LetterFigures;
};

/** The paragraphs of the index letter, separated by blank lines; stored in letterText. */
export function indexLetterText(content: LetterContent): string {
	const { figures } = content;
	const paragraphs = [
		greeting(content.tenants),
		`${content.tenants.length > 1 ? 'euer' : 'dein'} Mietvertrag für ${content.unitName} sieht ` +
			'eine Indexmiete nach § 557b BGB vor: Die ' +
			'Kaltmiete folgt dem Verbraucherpreisindex für Deutschland des Statistischen Bundesamts ' +
			`(Basisjahr ${figures.baseYear} = 100).`,
		`Der Index ist von ${formatIndexValue(figures.reference.value)} (${formatMonth(figures.reference.month)}) ` +
			`auf ${formatIndexValue(figures.latest.value)} (${formatMonth(figures.latest.month)}) gestiegen, ` +
			`das sind ${formatPercent(figures.percent)}. Die Kaltmiete erhöht sich entsprechend von ` +
			`${formatCents(figures.oldRent.baseRent)} um ${formatCents(figures.newRent.baseRent - figures.oldRent.baseRent)} ` +
			`auf ${formatCents(figures.newRent.baseRent)} im Monat.`,
		`Die neue Miete ist ab dem ${formatDate(figures.validFrom)} zu zahlen. Die Vorauszahlungen für ` +
			`Betriebskosten (${formatCents(figures.newRent.operatingCostPrepayment)}) und Heizkosten ` +
			`(${formatCents(figures.newRent.heatingCostPrepayment)}) bleiben unverändert; die Gesamtmiete ` +
			`beträgt dann ${formatCents(total(figures.newRent))} im Monat.`
	];
	return paragraphs.join('\n\n');
}

/** The rows of the old/new table under the letter: index, Kaltmiete, Gesamtmiete. */
export function indexLetterRows(figures: LetterFigures): string[][] {
	return [
		[
			'Verbraucherpreisindex',
			`${formatIndexValue(figures.reference.value)} (${formatMonth(figures.reference.month)})`,
			`${formatIndexValue(figures.latest.value)} (${formatMonth(figures.latest.month)})`
		],
		['Kaltmiete', formatCents(figures.oldRent.baseRent), formatCents(figures.newRent.baseRent)],
		['Gesamtmiete', formatCents(total(figures.oldRent)), formatCents(total(figures.newRent))]
	];
}
