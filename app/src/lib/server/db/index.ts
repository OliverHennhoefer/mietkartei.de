import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

/**
 * The database as the rest of the app sees it. better-sqlite3 (node target) and D1 (cloudflare
 * target) share this interface; every query is awaited so both behave the same.
 * D1 has no interactive transactions, so write multi-statement changes with `db.batch` instead.
 */
export type Database = BaseSQLiteDatabase<'sync' | 'async', unknown, typeof schema>;

export async function getDatabase(): Promise<Database> {
	// better-sqlite3 is a native module and cannot run on Workers, so the cloudflare bundle must
	// not contain it. __DEPLOY_TARGET__ is a build-time constant, which lets the bundler drop it.
	if (__DEPLOY_TARGET__ === 'cloudflare') {
		const { openD1 } = await import('./d1');
		return openD1();
	}
	const { openSqlite } = await import('./sqlite');
	return openSqlite();
}
