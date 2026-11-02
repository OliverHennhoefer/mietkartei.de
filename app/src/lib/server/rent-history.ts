import { and, eq, inArray } from 'drizzle-orm';
import { formatDate, type IsoDate } from '../dates';
import { laterRowUpdates, type RentAmounts, type RentFieldUpdate } from '../domain/rents';
import type { Database } from './db';
import { chunkIds } from './db/batch';
import { rentChanges } from './db/schema';

// Keeps the later rows of a rent history in line when a field changes from a date on. A row
// stores all three amounts, so without this a Staffel step entered up front would undo a later
// § 560 prepayment change (and the reverse). See laterRowUpdates in domain/rents.ts.

type HistoryRow = Parameters<typeof laterRowUpdates>[0][number];

export type LaterRows = {
	statements: ReturnType<typeof updateStatements>;
	count: number;
	updates: RentFieldUpdate[];
	/**
	 * The first later row the updates would leave with a parking share above its Kaltmiete (a
	 * share raised from an earlier date over a lower later rent), as a sentence; the caller
	 * refuses the change then.
	 */
	conflict: string | undefined;
};

function updateStatements(db: Database, accountId: string, updates: RentFieldUpdate[]) {
	return updates.flatMap((update) =>
		chunkIds(update.ids).map((ids) =>
			db
				.update(rentChanges)
				.set({ [update.field]: update.value })
				.where(and(eq(rentChanges.accountId, accountId), inArray(rentChanges.id, ids)))
		)
	);
}

/**
 * The update statements (for the caller's batch) that carry the fields changing from `validFrom`
 * on into the later approved rows that inherited the old value, and how many rows they touch.
 */
export function laterRows(
	db: Database,
	accountId: string,
	changes: readonly HistoryRow[],
	validFrom: IsoDate,
	before: RentAmounts,
	after: RentAmounts,
	excludeId?: string
): LaterRows {
	const updates = laterRowUpdates(changes, validFrom, before, after, excludeId);
	const ids = new Set(updates.flatMap((update) => update.ids));
	const result = { statements: updateStatements(db, accountId, updates), count: ids.size, updates };
	const [first] = withLaterRows(changes, { ...result, conflict: undefined })
		.filter((row) => ids.has(row.id) && row.parkingRent > row.baseRent)
		.map((row) => row.validFrom)
		.sort();
	const conflict = first
		? `Ab dem ${formatDate(first)} läge der Anteil für Garage/Stellplatz über der Kaltmiete. Passe zuerst diese spätere Mietänderung an.`
		: undefined;
	return { ...result, conflict };
}

/** The rows as they are once the statements of `later` ran, for the charges of the same batch. */
export function withLaterRows<T extends HistoryRow>(rows: readonly T[], later: LaterRows): T[] {
	return rows.map((row) => {
		let updated = row;
		for (const update of later.updates) {
			if (update.ids.includes(row.id)) updated = { ...updated, [update.field]: update.value };
		}
		return updated;
	});
}

/** No later rows to update, for a change that moves no field. */
export const noLaterRows: LaterRows = {
	statements: [],
	count: 0,
	updates: [],
	conflict: undefined
};

/** The audit sentence's tail when later rows follow: " (gilt auch für 2 spätere Mietänderungen)". */
export function laterRowsNote(rows: LaterRows): string {
	if (rows.count === 0) return '';
	return rows.count === 1
		? ' (gilt auch für 1 spätere Mietänderung)'
		: ` (gilt auch für ${rows.count} spätere Mietänderungen)`;
}
