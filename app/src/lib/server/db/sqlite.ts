import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DATABASE_PATH } from '$app/env/private';
import type { Database } from './index';
import * as schema from './schema';

let database: Database | undefined;

/** How many snapshots taken before a migration are kept next to the database. */
const keptBackups = 3;

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
	if (path !== ':memory:') backUpBeforeMigrating(client, path, migrationsFolder);
	const db = drizzle(client, { schema });
	migrate(db, { migrationsFolder });
	return db;
}

/**
 * Takes a snapshot of a database with data before new migrations change it, as
 * `backups/<name>-before-<first new migration>.db` next to the file, and keeps the last few. A
 * restore is copying it back while the app is stopped, see .github/SELF_HOSTING.md.
 */
function backUpBeforeMigrating(client: Sqlite.Database, path: string, migrationsFolder: string) {
	const applied = client
		.prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
		.get();
	// A new database has nothing to lose.
	if (!applied) return;
	const last = client.prepare('select max(created_at) as at from __drizzle_migrations').get() as {
		at: number | null;
	};
	const journal = JSON.parse(
		readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')
	) as {
		entries: { when: number; tag: string }[];
	};
	// The migrator applies every migration newer than the last one applied.
	const next = journal.entries.find((entry) => entry.when > Number(last.at ?? 0));
	if (!next) return;
	const folder = join(dirname(path), 'backups');
	mkdirSync(folder, { recursive: true });
	const name = basename(path).replace(/\.db$/, '');
	const target = join(folder, `${name}-before-${next.tag}.db`);
	rmSync(target, { force: true });
	client.prepare('VACUUM INTO ?').run(target);
	const backups = readdirSync(folder)
		.filter((file) => file.startsWith(`${name}-before-`) && file.endsWith('.db'))
		.sort();
	for (const old of backups.slice(0, -keptBackups)) rmSync(join(folder, old));
}
