import {
	daysInMonth,
	lastOfMonth,
	monthRange,
	overlap,
	type IsoDate,
	type IsoMonth
} from '../dates';
import { proRata } from '../money';

// The rent history of a lease is a list of changes, each valid from a date. Everything that needs
// "the rent in month X" (charges, prepayments in a statement) goes through this file.

export type RentAmounts = {
	baseRent: number;
	operatingCostPrepayment: number;
	heatingCostPrepayment: number;
};

export type RentChange = RentAmounts & {
	validFrom: IsoDate;
	status: 'approved' | 'proposed';
};

export type LeaseTerm = { startDate: IsoDate; endDate: IsoDate | null };

const zero: RentAmounts = { baseRent: 0, operatingCostPrepayment: 0, heatingCostPrepayment: 0 };

/** The approved change valid on the day: the latest validFrom on or before it. */
export function rentOn(changes: readonly RentChange[], date: IsoDate): RentChange | undefined {
	let current: RentChange | undefined;
	for (const change of changes) {
		if (change.status !== 'approved' || change.validFrom > date) continue;
		if (!current || change.validFrom >= current.validFrom) current = change;
	}
	return current;
}

export function total(amounts: RentAmounts): number {
	return amounts.baseRent + amounts.operatingCostPrepayment + amounts.heatingCostPrepayment;
}

/** The days of the month the lease runs, or undefined when it does not run in that month. */
export function occupiedDays(term: LeaseTerm, month: IsoMonth) {
	const range = monthRange(month);
	return overlap(range, { start: term.startDate, end: term.endDate ?? lastOfMonth('9999-12') });
}

/**
 * What the lease owes for a month: the rent valid on each day of the month, prorated by days
 * when the lease starts or ends mid-month or the rent changes mid-month. A full month at a
 * constant rent returns that rent exactly.
 */
export function monthlyAmounts(
	changes: readonly RentChange[],
	term: LeaseTerm,
	month: IsoMonth
): RentAmounts & { days: number; daysInMonth: number } {
	const [year, monthNumber] = month.split('-').map(Number);
	const total = daysInMonth(year, monthNumber);
	const occupied = occupiedDays(term, month);
	if (!occupied) return { ...zero, days: 0, daysInMonth: total };

	// Split the occupied days into stretches with one rent each.
	const stretches: { days: number; rent: RentAmounts }[] = [];
	let cursorDay = Number(occupied.start.slice(8, 10));
	const endDay = Number(occupied.end.slice(8, 10));
	while (cursorDay <= endDay) {
		const date = `${month}-${String(cursorDay).padStart(2, '0')}`;
		const rent = rentOn(changes, date) ?? zero;
		const last = stretches.at(-1);
		if (last && sameAmounts(last.rent, rent)) last.days += 1;
		else stretches.push({ days: 1, rent });
		cursorDay += 1;
	}

	const days = endDay - Number(occupied.start.slice(8, 10)) + 1;
	const full = days === total && stretches.length === 1;
	// Each field is rounded once over the whole month, not per stretch: a field that stays the same
	// across a mid-month change of another field keeps its exact amount (12345 × 15/30 twice would
	// round to 12346).
	const sum = (key: keyof RentAmounts) =>
		full
			? stretches[0].rent[key]
			: proRata(
					stretches.reduce((acc, stretch) => acc + stretch.rent[key] * stretch.days, 0),
					1,
					total
				);
	return {
		baseRent: sum('baseRent'),
		operatingCostPrepayment: sum('operatingCostPrepayment'),
		heatingCostPrepayment: sum('heatingCostPrepayment'),
		days,
		daysInMonth: total
	};
}

function sameAmounts(a: RentAmounts, b: RentAmounts): boolean {
	return (
		a.baseRent === b.baseRent &&
		a.operatingCostPrepayment === b.operatingCostPrepayment &&
		a.heatingCostPrepayment === b.heatingCostPrepayment
	);
}

export const rentFields = ['baseRent', 'operatingCostPrepayment', 'heatingCostPrepayment'] as const;

export type RentFieldUpdate = { field: keyof RentAmounts; value: number; ids: string[] };

/**
 * A history row stores all three amounts, so a row entered for a later date (a Staffel step
 * entered up front, a § 560 change) carries the other fields as they were when it was entered.
 * When the value of a field changes from `validFrom` on (a new row, an edited initial row, a
 * deleted row), the later approved rows that still carry the old value inherited it and must
 * follow; the first later row with a different value set the field itself, and the rows after it
 * follow that one. Returns, per changed field, the ids of the later rows to update.
 */
export function laterRowUpdates(
	changes: readonly (RentChange & { id: string })[],
	validFrom: IsoDate,
	before: RentAmounts,
	after: RentAmounts,
	excludeId?: string
): RentFieldUpdate[] {
	const later = changes
		.filter(
			(change) =>
				change.status === 'approved' && change.validFrom > validFrom && change.id !== excludeId
		)
		.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
	const updates: RentFieldUpdate[] = [];
	for (const field of rentFields) {
		if (before[field] === after[field]) continue;
		const ids: string[] = [];
		for (const change of later) {
			if (change[field] !== before[field]) break;
			ids.push(change.id);
		}
		if (ids.length > 0) updates.push({ field, value: after[field], ids });
	}
	return updates;
}
