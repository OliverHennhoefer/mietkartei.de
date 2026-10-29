import Sqlite from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Migrations that rebuild a table run on databases with data. Each runs in a transaction with
// foreign keys on, as the migrator does, so a cascade from dropping the old table shows here.

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
