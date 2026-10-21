import { and, eq, inArray } from 'drizzle-orm';
import type { IsoDate } from '../dates';
import { laterRowUpdates, type RentAmounts, type RentFieldUpdate } from '../domain/rents';
import type { Database } from './db';
import { chunkIds } from './db/batch';
import { rentChanges } from './db/schema';

// Keeps the later rows of a rent history in line when a field changes from a date on. A row
// stores all three amounts, so without this a Staffel step entered up front would undo a later
// § 560 prepayment change (and the reverse). See laterRowUpdates in domain/rents.ts.

type HistoryRow = Parameters<typeof laterRowUpdates>[0][number];

export type LaterRows = { statements: ReturnType<typeof updateStatements>; count: number };

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
	const count = new Set(updates.flatMap((update) => update.ids)).size;
	return { statements: updateStatements(db, accountId, updates), count };
}

/** The audit sentence's tail when later rows follow: " (gilt auch für 2 spätere Mietänderungen)". */
export function laterRowsNote(rows: LaterRows): string {
	if (rows.count === 0) return '';
	return rows.count === 1
		? ' (gilt auch für 1 spätere Mietänderung)'
		: ` (gilt auch für ${rows.count} spätere Mietänderungen)`;
}
