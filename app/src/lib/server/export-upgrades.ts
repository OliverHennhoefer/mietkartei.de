import journal from '../../../drizzle/meta/_journal.json';

// Upgrades of export.json: an export records the schema it was written with (`schema`, the tag of
// the last migration of that instance). Before a restore, every migration the export does not
// have yet gets the chance to change its rows the way it changed the databases, so an export of
// an older instance restores without losing what that migration would have kept. The spec checks
// that every migration that moves, renames or drops data has an entry here.

/** The rows of export.json per SQL table name; keys of a row are the schema's property names. */
export type ExportTables = Record<string, Record<string, unknown>[]>;

/** Changes the rows of an older export like the migration changed the database. */
export type ExportUpgrade = (tables: ExportTables) => void;

/** The migrations of this version, oldest first. */
export const migrationTags: readonly string[] = journal.entries.map((entry) => entry.tag);

/** The schema an export of this version records. */
export const currentSchema = migrationTags[migrationTags.length - 1];

/**
 * The first migration after the oldest export a restore has to read: exports exist since the
 * internal go-live on 2 November 2026, which ran 0055_notifications.
 */
export const firstUpgradedMigration = '0056_parking_rent';

/**
 * Exports written before they recorded their schema (until November 2026) are from somewhere
 * between 0055 and 0066. They get every upgrade, so each upgrade only changes rows that still
 * have the old shape.
 */
export const unrecordedSchema = '0055_notifications';

/**
 * One entry per migration since firstUpgradedMigration that moves, renames or drops data: the
 * upgrade, or null when the rows of an export need no change (say why next to it).
 */
export const exportUpgrades: Record<string, ExportUpgrade | null> = {
	// Deleted the ntfy channels; notification channels are not in an export.
	'0057_push_channels': null,
	// Rebuilt matching_rules with a name, which the migration set to "Miete <unit>" for the rules
	// of a lease; the new columns elsewhere start empty, as the migration left them.
	'0064_contra_accounts': (tables) => {
		const units = new Map((tables.units ?? []).map((unit) => [unit.id, unit]));
		const leases = new Map((tables.leases ?? []).map((lease) => [lease.id, lease]));
		for (const rule of tables.matching_rules ?? []) {
			if ('name' in rule) continue;
			const unit = units.get(leases.get(rule.leaseId)?.unitId);
			rule.name = unit ? `Miete ${String(unit.name)}` : null;
		}
	}
};

export type SchemaCheck = { ok: true; upgrades: ExportUpgrade[] } | { ok: false };

/**
 * The upgrades an export of `schema` needs here, oldest first; not ok for a schema this version
 * does not know, such as one of a newer version.
 */
export function upgradesFor(schema: unknown): SchemaCheck {
	const from = schema === undefined ? unrecordedSchema : schema;
	const index = migrationTags.indexOf(from as string);
	if (typeof from !== 'string' || index < 0) return { ok: false };
	const upgrades = migrationTags
		.slice(index + 1)
		.map((tag) => exportUpgrades[tag])
		.filter((upgrade): upgrade is ExportUpgrade => typeof upgrade === 'function');
	return { ok: true, upgrades };
}
