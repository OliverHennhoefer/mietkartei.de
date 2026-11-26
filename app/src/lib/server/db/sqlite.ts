import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DATABASE_PATH } from '$app/env/private';
import type { Database } from './index';

let database: Database | undefined;

/** How many snapshots taken before a migration are kept next to the database. */
const keptBackups = 3;

/** Opens the SQLite file once per process and brings its schema up to date. */
export function openSqlite(): Database {
	if (!database) {
		// A container without a persistent volume starts over with an empty database whenever it is
		// recreated, and the first sign-up then takes over the instance. Say so in the log.
		assertWritable(DATABASE_PATH);
		if (!existsSync(DATABASE_PATH)) {
			console.warn(
				`No database at ${DATABASE_PATH}, starting with an empty one. If data was expected ` +
					'here, the data directory is not on a persistent volume or host folder.'
			);
		}
		database = createSqliteDatabase(DATABASE_PATH);
	}
	return database;
}

/**
 * Fails with a message that names the fix when the process cannot write the database file or its
 * directory, typically a host folder mounted as /data that belongs to root while the container
 * runs as user 1000. SQLite itself only reports SQLITE_CANTOPEN or "attempt to write a readonly
 * database". The directory needs write access too, for the -wal and -shm files and the backups.
 */
export function assertWritable(path: string) {
	const directory = dirname(path);
	const user = process.getuid?.();
	const fix =
		user === undefined
			? 'Give the user that runs mietkartei write access to it.'
			: `Give user ${user} write access, e.g. on the host: chown -R ${user}:${process.getgid?.() ?? user} <folder mounted as ${directory}>`;
	try {
		mkdirSync(directory, { recursive: true });
		accessSync(directory, constants.W_OK);
	} catch {
		throw new Error(`The data directory ${directory} is not writable. ${fix}`);
	}
	if (!existsSync(path)) return;
	try {
		accessSync(path, constants.R_OK | constants.W_OK);
	} catch {
		throw new Error(`The database ${path} is not writable. ${fix}`);
	}
}

export function createSqliteDatabase(path: string, migrationsFolder = 'drizzle'): Database {
	if (path !== ':memory:') assertWritable(path);
	const client = new Sqlite(path);
	client.pragma('journal_mode = WAL');
	client.pragma('foreign_keys = ON');
	if (path !== ':memory:') backUpBeforeMigrating(client, path, migrationsFolder);
	const db = drizzle(client);
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
