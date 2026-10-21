import { asc, getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { DEFAULT_ACCOUNT_ID, ensureDefaultAccount } from './accounts';
import type { Database } from './db';
import { chunk, rowsPerStatement, runBatch } from './db/batch';
import * as schema from './db/schema';
import { accounts, leaseTenants, leases, properties, tenants, units, users } from './db/schema';

// Seeds data for the end-to-end tests, behind POST /__e2e/seed (only when E2E is set). A feature's
// test creates the prerequisites it does not own here, instead of driving other features' pages.
// Everything lands in the account of the first registered user: the e2e owner takes over the
// default account, as the first user always does.

export type SeedResult = { status: number; body: unknown };

export type SeedLeaseOverrides = {
	property?: Partial<typeof properties.$inferInsert>;
	unit?: Partial<typeof units.$inferInsert>;
	tenant?: Partial<typeof tenants.$inferInsert>;
	lease?: Partial<typeof leases.$inferInsert>;
};

export type SeedLeaseResult = {
	propertyId: string;
	unitId: string;
	tenantId: string;
	leaseId: string;
};

type Row = Record<string, unknown>;

function isPlainObject(value: unknown): value is Row {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bad(message: string): SeedResult {
	return { status: 400, body: { message } };
}

/** The account of the first user (the e2e owner); the default account while no one exists. */
async function ownerAccount(db: Database): Promise<string> {
	const [owner] = await db
		.select({ accountId: users.accountId })
		.from(users)
		.orderBy(asc(users.createdAt), sql`rowid`)
		.limit(1);
	if (owner) return owner.accountId;
	await ensureDefaultAccount(db);
	return DEFAULT_ACCOUNT_ID;
}

/** Finds a table of the schema by its export name (`leaseTenants`) or SQL name (`lease_tenants`). */
function findTable(name: string): SQLiteTable | undefined {
	for (const [exportName, value] of Object.entries(schema)) {
		if (is(value, SQLiteTable) && (exportName === name || getTableName(value) === name)) {
			return value;
		}
	}
	return undefined;
}

/**
 * Maps a JSON row onto the table's columns: the account is forced, a missing id generated,
 * timestamps accepted as milliseconds or ISO strings. Unknown keys are refused, so a typo in a
 * test fails loudly instead of silently dropping a value.
 */
function toRow(table: SQLiteTable, row: Row, accountId: string): Row | string {
	const columns = getTableColumns(table);
	const values: Row = {};
	for (const [key, value] of Object.entries(row)) {
		const column = columns[key];
		if (!column) return `Unbekannte Spalte „${key}“ in Tabelle „${getTableName(table)}“.`;
		if (value === undefined) continue;
		values[key] =
			column.dataType === 'date' && (typeof value === 'number' || typeof value === 'string')
				? new Date(value)
				: value;
	}
	if ('accountId' in columns) values.accountId = accountId;
	if ('id' in columns && typeof values.id !== 'string') values.id = crypto.randomUUID();
	return values;
}

async function seedLease(
	db: Database,
	accountId: string,
	overrides: SeedLeaseOverrides
): Promise<SeedResult> {
	// Repeated calls create distinct names, so a test can find its own rows by name.
	const suffix = crypto.randomUUID().slice(0, 4);
	const ids = {
		propertyId: crypto.randomUUID(),
		unitId: crypto.randomUUID(),
		tenantId: crypto.randomUUID(),
		leaseId: crypto.randomUUID()
	};
	await runBatch(db, [
		db.insert(properties).values({
			name: `Testhaus ${suffix}`,
			street: 'Lindenstraße 4',
			postalCode: '10115',
			city: 'Berlin',
			...overrides.property,
			id: ids.propertyId,
			accountId
		}),
		db.insert(units).values({
			name: `Wohnung ${suffix}`,
			kind: 'apartment',
			floorArea: 64,
			...overrides.unit,
			id: ids.unitId,
			accountId,
			propertyId: ids.propertyId
		}),
		db.insert(tenants).values({
			firstName: 'Erika',
			lastName: `Muster-${suffix}`,
			...overrides.tenant,
			id: ids.tenantId,
			accountId
		}),
		db.insert(leases).values({
			startDate: '2025-01-01',
			baseRent: 60000,
			operatingCostPrepayment: 15000,
			securityDeposit: 180000,
			...overrides.lease,
			id: ids.leaseId,
			accountId,
			unitId: ids.unitId
		}),
		db.insert(leaseTenants).values({ leaseId: ids.leaseId, tenantId: ids.tenantId })
	]);
	const body: SeedLeaseResult = ids;
	return { status: 200, body };
}

/** The account no e2e user belongs to; its ids must answer 404 to the owner. */
export const FOREIGN_ACCOUNT_ID = 'e2e-foreign';

/** A lease with property, unit and tenant in a second account, for the 404 checks. */
async function seedForeignLease(db: Database): Promise<SeedResult> {
	await db
		.insert(accounts)
		.values({ id: FOREIGN_ACCOUNT_ID, name: 'Fremdes Konto' })
		.onConflictDoNothing();
	return seedLease(db, FOREIGN_ACCOUNT_ID, {});
}

async function seedRows(db: Database, accountId: string, body: Row): Promise<SeedResult> {
	if (typeof body.table !== 'string') return bad('Bitte gib die Tabelle an.');
	const table = findTable(body.table);
	if (!table) return bad(`Unbekannte Tabelle „${body.table}“.`);
	if (!Array.isArray(body.rows) || !body.rows.every(isPlainObject)) {
		return bad('Bitte gib die Zeilen als Liste von Objekten an.');
	}
	const rows: Row[] = [];
	for (const row of body.rows) {
		const mapped = toRow(table, row, accountId);
		if (typeof mapped === 'string') return bad(mapped);
		rows.push(mapped);
	}
	await runBatch(
		db,
		chunk(rows, rowsPerStatement(table)).map((group) => db.insert(table).values(group))
	);
	// Tables without an id column (link tables) yield no ids.
	const ids = rows.flatMap((row) => (typeof row.id === 'string' ? [row.id] : []));
	return { status: 200, body: { ids } };
}

/**
 * Runs one seed operation, chosen by `body.op`: `lease` (property, unit, tenant and lease),
 * `foreignLease` (the same in a second account no e2e user belongs to, for the 404 checks) or
 * `rows` (raw rows of any table). Returns the HTTP status and body for the route.
 */
export async function seed(db: Database, body: unknown): Promise<SeedResult> {
	if (!isPlainObject(body)) return bad('Der Körper ist ein JSON-Objekt mit „op“.');
	const accountId = await ownerAccount(db);
	try {
		switch (body.op) {
			case 'lease': {
				const overrides: SeedLeaseOverrides = {};
				for (const key of ['property', 'unit', 'tenant', 'lease'] as const) {
					const value = body[key];
					if (value === undefined) continue;
					if (!isPlainObject(value))
						return bad(`„${key}“ ist ein Objekt mit den Überschreibungen.`);
					overrides[key] = value;
				}
				return await seedLease(db, accountId, overrides);
			}
			case 'foreignLease':
				return await seedForeignLease(db);
			case 'rows':
				return await seedRows(db, accountId, body);
			default:
				return bad('Unbekannte Operation; erlaubt sind lease, foreignLease und rows.');
		}
	} catch (error) {
		// A constraint violation or a wrong value type; the message tells the test what went wrong.
		return {
			status: 500,
			body: { message: error instanceof Error ? error.message : String(error) }
		};
	}
}
