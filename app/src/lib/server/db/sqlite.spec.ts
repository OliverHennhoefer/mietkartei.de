import Sqlite from 'better-sqlite3';
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from './index';
import { assertWritable, createSqliteDatabase, openSqlite } from './sqlite';

const env = vi.hoisted(() => ({ databasePath: '' }));
vi.mock('$app/env/private', () => ({
	get DATABASE_PATH() {
		return env.databasePath;
	}
}));

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mietkartei-backup-'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

/** The better-sqlite3 connection under the Drizzle database. */
const client = (db: Database) => (db as unknown as { $client: Sqlite.Database }).$client;

type Journal = { entries: { tag: string }[] };

/** A copy of the migrations folder without its last `drop` migrations, as an older release had it. */
function olderMigrations(drop: number): string {
	const folder = join(root, `drizzle-${drop}`);
	cpSync('drizzle', folder, { recursive: true });
	const journalPath = join(folder, 'meta/_journal.json');
	const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
	for (const entry of journal.entries.splice(-drop)) rmSync(join(folder, `${entry.tag}.sql`));
	writeFileSync(journalPath, JSON.stringify(journal));
	return folder;
}

const lastTags = (count: number) =>
	(JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as Journal).entries
		.slice(-count)
		.map((entry) => entry.tag);

describe('createSqliteDatabase', () => {
	it('takes no snapshot of a new database or of one that is up to date', () => {
		const path = join(root, 'mietkartei.db');
		client(createSqliteDatabase(path)).close();
		client(createSqliteDatabase(path)).close();
		expect(existsSync(join(root, 'backups'))).toBe(false);
	});

	it('snapshots the data before new migrations and keeps the last three snapshots', () => {
		const path = join(root, 'mietkartei.db');
		const oldest = createSqliteDatabase(path, olderMigrations(4));
		client(oldest).exec(`insert into accounts (id, name) values ('a', 'Hausverwaltung')`);
		client(oldest).close();
		for (const drop of [3, 2, 1, 0]) {
			client(createSqliteDatabase(path, drop === 0 ? 'drizzle' : olderMigrations(drop))).close();
		}
		const tags = lastTags(4);
		expect(readdirSync(join(root, 'backups'))).toEqual(
			tags.slice(1).map((tag) => `mietkartei-before-${tag}.db`)
		);
		const backup = new Sqlite(join(root, 'backups', `mietkartei-before-${tags[3]}.db`));
		expect(backup.prepare('select name from accounts').all()).toEqual([{ name: 'Hausverwaltung' }]);
		// The snapshot is the state before the last migration.
		const migrations = readdirSync('drizzle').filter((file) => file.endsWith('.sql')).length;
		expect(backup.prepare('select count(*) as count from __drizzle_migrations').get()).toEqual({
			count: migrations - 1
		});
		backup.close();
	});
});

describe('openSqlite', () => {
	it('warns once in the log when it starts with a new, empty database', () => {
		env.databasePath = join(root, 'data', 'mietkartei.db');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const db = openSqlite();
			expect(existsSync(env.databasePath)).toBe(true);
			expect(openSqlite()).toBe(db);
			expect(warn).toHaveBeenCalledOnce();
			expect(warn.mock.calls[0][0]).toContain(`No database at ${env.databasePath}`);
			client(db).close();
		} finally {
			warn.mockRestore();
		}
	});

	it('opens an existing database without a warning', async () => {
		env.databasePath = join(root, 'mietkartei.db');
		client(createSqliteDatabase(env.databasePath)).close();
		vi.resetModules();
		const { openSqlite: openFresh } = await import('./sqlite');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			client(openFresh()).close();
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});

// Root may write anywhere, so these only run as an ordinary user, as in CI and in the container.
describe.skipIf(process.getuid?.() === 0)('assertWritable', () => {
	it('names the fix when the data directory is not writable', () => {
		const directory = join(root, 'data');
		mkdirSync(directory);
		chmodSync(directory, 0o555);
		try {
			expect(() => createSqliteDatabase(join(directory, 'mietkartei.db'))).toThrow(
				`The data directory ${directory} is not writable. Give user ${process.getuid?.()} write access`
			);
		} finally {
			chmodSync(directory, 0o755);
		}
	});

	it('names the fix when the database file is not writable', () => {
		const path = join(root, 'mietkartei.db');
		client(createSqliteDatabase(path)).close();
		chmodSync(path, 0o444);
		expect(() => assertWritable(path)).toThrow(`The database ${path} is not writable.`);
	});
});

describe('assertWritable', () => {
	it('accepts a writable directory and creates it', () => {
		const path = join(root, 'new', 'mietkartei.db');
		assertWritable(path);
		expect(existsSync(join(root, 'new'))).toBe(true);
	});
});
