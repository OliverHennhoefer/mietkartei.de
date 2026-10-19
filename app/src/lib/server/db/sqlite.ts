import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DATABASE_PATH } from '$app/env/private';
import type { Database } from './index';
import * as schema from './schema';

let database: Database | undefined;

/** Opens the SQLite file once per process and brings its schema up to date. */
export function openSqlite(): Database {
	if (!database) database = createSqliteDatabase(DATABASE_PATH);
	return database;
}

export function createSqliteDatabase(path: string, migrationsFolder = 'drizzle'): Database {
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const client = new Sqlite(path);
	client.pragma('journal_mode = WAL');
	client.pragma('foreign_keys = ON');
	const db = drizzle(client, { schema });
	migrate(db, { migrationsFolder });
	return db;
}
