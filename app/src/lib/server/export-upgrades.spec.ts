import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	currentSchema,
	exportUpgrades,
	firstUpgradedMigration,
	migrationTags,
	unrecordedSchema,
	upgradesFor
} from './export-upgrades';

const folder = 'drizzle';

/** Whether a migration changes rows that exist, not only adds tables, columns or indexes. */
function movesData(sql: string): boolean {
	const statements = sql
		.split('--> statement-breakpoint')
		.map((statement) => statement.replace(/^\s*FOREIGN KEY .*$/gm, ''));
	return statements.some((statement) =>
		/^\s*(UPDATE\s|DELETE\s|INSERT\s+INTO\s)|\sRENAME\s|\sDROP\s+COLUMN\s|^\s*DROP\s+TABLE\s/im.test(
			statement
		)
	);
}

describe('export upgrades', () => {
	it('names the schema of this version and knows every migration', () => {
		const files = readdirSync(folder)
			.filter((file) => file.endsWith('.sql'))
			.map((file) => file.slice(0, -4))
			.sort();
		expect(migrationTags).toEqual(files);
		expect(currentSchema).toBe(files.at(-1));
		expect(migrationTags).toContain(firstUpgradedMigration);
		expect(migrationTags.indexOf(unrecordedSchema)).toBe(
			migrationTags.indexOf(firstUpgradedMigration) - 1
		);
	});

	it('has an entry for every migration that moves, renames or drops data', () => {
		const since = migrationTags.slice(migrationTags.indexOf(firstUpgradedMigration));
		const moving = since.filter((tag) => movesData(readFileSync(`${folder}/${tag}.sql`, 'utf8')));
		expect(moving).toContain('0064_contra_accounts');
		// A new migration that changes rows needs an upgrade in exportUpgrades, or null when an
		// older export needs none, so restoring an older export keeps what the migration kept.
		expect(Object.keys(exportUpgrades).sort()).toEqual(moving);
	});

	it('lists the upgrades after the schema of an export, and none for an unknown one', () => {
		expect(upgradesFor(currentSchema)).toEqual({ ok: true, upgrades: [] });
		expect(upgradesFor('0063_deleted_accounts')).toEqual({
			ok: true,
			upgrades: [exportUpgrades['0064_contra_accounts']]
		});
		expect(upgradesFor(undefined)).toEqual(upgradesFor(unrecordedSchema));
		expect(upgradesFor('0999_future')).toEqual({ ok: false });
		expect(upgradesFor(null)).toEqual({ ok: false });
	});
});
