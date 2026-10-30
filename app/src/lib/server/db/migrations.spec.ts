import Sqlite from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Migrations run on databases with data. Each runs in a transaction with foreign keys on, as the
// migrator and D1 do, so a cascade from dropping a rebuilt table shows here. See
// .github/MIGRATIONS.md.

const folder = 'drizzle';
const files = readdirSync(folder)
	.filter((name) => name.endsWith('.sql'))
	.sort();

function apply(db: Sqlite.Database, file: string) {
	db.transaction(() => {
		for (const statement of readFileSync(`${folder}/${file}`, 'utf8').split(
			'--> statement-breakpoint'
		)) {
			if (statement.trim()) db.exec(statement);
		}
	})();
}

/**
 * Rows a migration was meant to drop, by migration and table. Data loss was acceptable until
 * 2 November 2026; since then a migration keeps every row and value, so nothing is added here.
 */
const intendedLosses: Record<string, string[]> = {
	// The sessions table was created anew: everyone signed in again.
	'0011_session_created_at': ['sessions'],
	// The index values were refetched for all accounts at once.
	'0030_global_consumer_price_index': ['consumer_price_index'],
	'0035_oauth': ['api_keys']
};

type Row = Record<string, unknown>;
type ForeignKey = { table: string; from: string; to: string | null };
type Column = { name: string; type: string; notnull: number };

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

function tableNames(db: Sqlite.Database): string[] {
	return db
		.prepare(
			"select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'"
		)
		.all()
		.map((row) => (row as { name: string }).name);
}

/**
 * Adds one row to every table, each referencing the row just added to its parent tables and with
 * a distinct value in every other column, so no unique index refuses it. Nullable `_id` columns
 * without a foreign key stay null: a later migration may turn them into one.
 */
function addRows(db: Sqlite.Database, next: () => number) {
	const tables = tableNames(db);
	const foreignKeys = new Map(
		tables.map((table) => [table, db.pragma(`foreign_key_list(${quote(table)})`) as ForeignKey[]])
	);
	const latest = new Map<string, Row>();
	const pending = new Set(tables);
	while (pending.size > 0) {
		const ready = [...pending].filter((table) =>
			foreignKeys.get(table)!.every((key) => key.table === table || !pending.has(key.table))
		);
		for (const table of ready.length > 0 ? ready : [[...pending][0]]) {
			pending.delete(table);
			const row: Row = {};
			for (const column of db.pragma(`table_info(${quote(table)})`) as Column[]) {
				const key = foreignKeys.get(table)!.find((key) => key.from === column.name);
				if (key) {
					const parent = key.table === table ? undefined : latest.get(key.table);
					if (parent) row[column.name] = parent[key.to ?? 'id'];
					else if (!column.notnull) row[column.name] = null;
				} else if (column.name.endsWith('_id') && !column.notnull) {
					row[column.name] = null;
				} else {
					const value = next();
					const type = column.type.toLowerCase();
					row[column.name] = type.includes('int')
						? value
						: type.includes('real')
							? value + 0.5
							: `v${value}`;
				}
			}
			const columns = Object.keys(row);
			db.prepare(
				`insert into ${quote(table)} (${columns.map(quote).join(', ')}) values (${columns.map(() => '?').join(', ')})`
			).run(columns.map((column) => row[column]));
			latest.set(table, row);
		}
	}
}

function snapshot(db: Sqlite.Database) {
	return new Map(
		tableNames(db).map((table) => [
			table,
			{
				columns: (db.pragma(`table_info(${quote(table)})`) as Column[]).map((c) => c.name),
				rows: db.prepare(`select * from ${quote(table)}`).all() as Row[]
			}
		])
	);
}

/** Tables that lost rows, or values in a column they kept, from `before` to `after`. */
function losses(before: ReturnType<typeof snapshot>, after: ReturnType<typeof snapshot>) {
	const lost: string[] = [];
	for (const [table, old] of before) {
		const current = after.get(table);
		// A dropped or renamed table is a deliberate step the review sees in the migration.
		if (!current) continue;
		const kept = old.columns.filter((column) => current.columns.includes(column));
		const key = (row: Row) => JSON.stringify(kept.map((column) => row[column]));
		const remaining = new Map<string, number>();
		for (const row of current.rows) remaining.set(key(row), (remaining.get(key(row)) ?? 0) + 1);
		for (const row of old.rows) {
			const count = remaining.get(key(row)) ?? 0;
			if (count === 0) {
				lost.push(table);
				break;
			}
			remaining.set(key(row), count - 1);
		}
	}
	return lost;
}

describe('the migrations', () => {
	it('are listed in the journal in order, so the migrator of the node target applies each', () => {
		const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, 'utf8')) as {
			entries: { idx: number; when: number; tag: string }[];
		};
		expect(journal.entries.map((entry) => `${entry.tag}.sql`)).toEqual(files);
		journal.entries.forEach((entry, index) => {
			expect(entry.idx).toBe(index);
			expect(entry.tag.startsWith(String(index).padStart(4, '0') + '_')).toBe(true);
			// The node migrator skips a migration older than the last one applied.
			if (index > 0) expect(entry.when).toBeGreaterThan(journal.entries[index - 1].when);
		});
	});

	it('keep every row and value of a database that has data in every table', () => {
		const db = new Sqlite(':memory:');
		db.pragma('foreign_keys = ON');
		let counter = 0;
		const next = () => ++counter;
		for (const [index, file] of files.entries()) {
			if (index > 0) addRows(db, next);
			const before = snapshot(db);
			apply(db, file);
			const tag = file.replace(/\.sql$/, '');
			expect({ tag, lost: losses(before, snapshot(db)) }).toEqual({
				tag,
				lost: intendedLosses[tag] ?? []
			});
			expect(db.pragma('foreign_key_check')).toEqual([]);
		}
	});

	it('index every foreign key column, so deleting a parent row needs no table scan', () => {
		const db = new Sqlite(':memory:');
		for (const file of files) apply(db, file);
		const unindexed = tableNames(db).flatMap((table) => {
			const leading = (db.pragma(`index_list(${quote(table)})`) as { name: string }[]).map(
				(index) => (db.pragma(`index_info(${quote(index.name)})`) as { name: string }[])[0]?.name
			);
			return (db.pragma(`foreign_key_list(${quote(table)})`) as ForeignKey[])
				.filter((key) => !leading.includes(key.from))
				.map((key) => `${table}.${key.from}`);
		});
		expect(unindexed).toEqual([]);
	});
});

describe('0028_rent_charge_reversal_link', () => {
	it('keeps a reversal and the charge it reverses', () => {
		const db = new Sqlite(':memory:');
		db.pragma('foreign_keys = ON');
		for (const file of files.filter((name) => name < '0028')) apply(db, file);
		db.exec(`
			insert into accounts (id, name) values ('a', 'A');
			insert into properties (id, account_id, name, street, postal_code, city)
				values ('p', 'a', 'Haus', 'Weg 1', '10115', 'Berlin');
			insert into units (id, account_id, property_id, name, kind) values ('u', 'a', 'p', 'EG', 'apartment');
			insert into leases (id, account_id, unit_id, start_date, base_rent) values ('l', 'a', 'u', '2025-01-01', 1);
			insert into rent_charges (id, account_id, lease_id, period, amount, kind, reference_id)
				values ('charge', 'a', 'l', '2025-01', 100, 'statement_balance', 's');
			insert into rent_charges (id, account_id, lease_id, period, amount, kind, reference_id, reverses_charge_id)
				values ('reversal', 'a', 'l', '2025-01', -100, 'statement_balance', 's2', 'charge');
		`);
		apply(
			db,
			files.find((name) => name.startsWith('0028'))!
		);
		expect(db.prepare('select id from rent_charges order by id').all()).toEqual([
			{ id: 'charge' },
			{ id: 'reversal' }
		]);
		expect(db.pragma('foreign_key_check')).toEqual([]);
		// The reference followed the rename: deleting the charge takes its reversal along.
		db.exec(`delete from rent_charges where id = 'charge'`);
		expect(db.prepare('select id from rent_charges').all()).toEqual([]);
	});
});

describe('0052_service_providers', () => {
	it('renames the Handwerker to Dienstleister and keeps the tasks that name them', () => {
		const db = new Sqlite(':memory:');
		db.pragma('foreign_keys = ON');
		for (const file of files.filter((name) => name < '0052')) apply(db, file);
		db.exec(`
			insert into accounts (id, name) values ('a', 'A');
			insert into contractors (id, account_id, name, trade) values ('c', 'a', 'Wendt', 'Sanitär');
			insert into tasks (id, account_id, title, contractor_id) values ('t', 'a', 'Leck', 'c');
			insert into expenses (id, account_id, date, amount, category, description, task_id)
				values ('e', 'a', '2026-01-01', 100, 'maintenance', 'Rechnung', 't');
		`);
		apply(
			db,
			files.find((name) => name.startsWith('0052'))!
		);
		expect(db.prepare('select id, name, service from service_providers').all()).toEqual([
			{ id: 'c', name: 'Wendt', service: 'Sanitär' }
		]);
		expect(db.prepare('select service_provider_id from tasks').all()).toEqual([
			{ service_provider_id: 'c' }
		]);
		db.exec(`update expenses set service_provider_id = 'c'`);
		expect(db.pragma('foreign_key_check')).toEqual([]);
		// The references followed the rename: an unknown Dienstleister is refused.
		expect(() => db.exec(`update tasks set service_provider_id = 'x'`)).toThrow();
		expect(() => db.exec(`update expenses set service_provider_id = 'x'`)).toThrow();
	});
});
