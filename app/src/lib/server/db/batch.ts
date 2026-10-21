import { getTableColumns, type Table } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from './index';

// D1 has no interactive transactions, only `batch`, which runs statements atomically. better-sqlite3
// has no `batch`, but its statements run synchronously, so a transaction can run the same list.

type Statement = BatchItem<'sqlite'>;

/** Runs all statements atomically on either driver. Statements are built on `db` as usual. */
export async function runBatch(db: Database, statements: Statement[]): Promise<void> {
	if (statements.length === 0) return;
	if ('batch' in db && typeof db.batch === 'function') {
		await (db.batch as (items: [Statement, ...Statement[]]) => Promise<unknown>)(
			statements as [Statement, ...Statement[]]
		);
		return;
	}
	const sync = db as unknown as { transaction(fn: () => void): void };
	sync.transaction(() => {
		for (const statement of statements) (statement as unknown as { run(): unknown }).run();
	});
}

/**
 * D1 allows at most 100 bound parameters per statement, so bulk inserts are split into groups of
 * `size` rows. Use `rowsPerStatement(table)` for the size of an insert.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
	const groups: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		groups.push(items.slice(index, index + size));
	}
	return groups;
}

/**
 * How many rows one `insert(table).values([...])` may carry: every column is bound, including
 * the `id` default (generated in JS), so rows × columns must stay below 100.
 */
export function rowsPerStatement(table: Table): number {
	return Math.max(1, Math.floor(100 / Object.keys(getTableColumns(table)).length));
}

/** Splits a list of ids for `inArray`, which binds one parameter per id. */
export function chunkIds<T>(ids: readonly T[]): T[][] {
	return chunk(ids, 90);
}
