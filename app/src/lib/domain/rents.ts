import type { IsoDate } from '../dates';

// The rent history of a lease is a list of changes, each valid from a date. Everything that needs
// "the rent on day X" goes through this file.

export type RentAmounts = {
	baseRent: number;
	operatingCostPrepayment: number;
	heatingCostPrepayment: number;
};

export type RentChange = RentAmounts & {
	validFrom: IsoDate;
	status: 'approved' | 'proposed';
};

/** The approved change valid on the day: the latest validFrom on or before it. */
export function rentOn(changes: readonly RentChange[], date: IsoDate): RentChange | undefined {
	let current: RentChange | undefined;
	for (const change of changes) {
		if (change.status !== 'approved' || change.validFrom > date) continue;
		if (!current || change.validFrom >= current.validFrom) current = change;
	}
	return current;
}

const rentFields = ['baseRent', 'operatingCostPrepayment', 'heatingCostPrepayment'] as const;

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
