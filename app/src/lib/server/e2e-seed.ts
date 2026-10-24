import { and, asc, eq, getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { DEFAULT_ACCOUNT_ID, ensureDefaultAccount } from './accounts';
import type { AuditContext } from './audit';
import { createSession, hashPassword, normalizeEmail } from './auth';
import type { Database } from './db';
import { chunk, rowsPerStatement, runBatch } from './db/batch';
import * as schema from './db/schema';
import {
	accounts,
	consumerPriceIndex,
	properties,
	tenants,
	units,
	userRoles,
	users,
	type UserRole
} from './db/schema';
import { newLeaseStatements, type LeaseInput } from './leases';

// Seeds data for the end-to-end tests, behind POST /api/e2e/seed (only when E2E is set). A feature's
// test creates the prerequisites it does not own here, instead of driving other features' pages.
// Everything lands in the account of the first registered user: the e2e owner takes over the
// default account, as the first user always does.

export type SeedResult = { status: number; body: unknown };

export type SeedLeaseOverrides = {
	property?: Partial<typeof properties.$inferInsert>;
	unit?: Partial<typeof units.$inferInsert>;
	tenant?: Partial<typeof tenants.$inferInsert>;
	lease?: Partial<LeaseInput>;
};

export type SeedLeaseResult = {
	propertyId: string;
	unitId: string;
	tenantId: string;
	leaseId: string;
};

export type SeedUser = { email: string; password: string; role: UserRole; name?: string | null };

type Row = Record<string, unknown>;

function isPlainObject(value: unknown): value is Row {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bad(message: string): SeedResult {
	return { status: 400, body: { message } };
}

/** The first user (the e2e owner) and their account; the default account while no one exists. */
async function ownerContext(db: Database): Promise<AuditContext> {
	const [owner] = await db
		.select({ id: users.id, accountId: users.accountId })
		.from(users)
		.orderBy(asc(users.createdAt), sql`rowid`)
		.limit(1);
	if (owner) return { accountId: owner.accountId, userId: owner.id };
	await ensureDefaultAccount(db);
	return { accountId: DEFAULT_ACCOUNT_ID, userId: null };
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
	context: AuditContext,
	overrides: SeedLeaseOverrides
): Promise<SeedResult> {
	const { accountId } = context;
	// Repeated calls create distinct names, so a test can find its own rows by name.
	const suffix = crypto.randomUUID().slice(0, 4);
	const ids = {
		propertyId: crypto.randomUUID(),
		unitId: crypto.randomUUID(),
		tenantId: crypto.randomUUID(),
		leaseId: crypto.randomUUID()
	};
	// The same plain lease as leaseInput() in testing.ts, which cannot be imported here because
	// it pulls in the SQLite driver.
	const input: LeaseInput = {
		unitId: ids.unitId,
		extraUnitIds: [],
		tenantIds: [ids.tenantId],
		startDate: '2025-01-01',
		endDate: null,
		kind: 'residential',
		rentModel: 'fixed',
		operatingCostModel: 'prepayment',
		heatingCostModel: 'prepayment',
		baseRent: 60000,
		operatingCostPrepayment: 15000,
		heatingCostPrepayment: 5000,
		securityDeposit: 180000,
		persons: 2,
		rentDueDay: 3,
		ledgerStart: null,
		indexBaseMonth: null,
		indexBaseValue: null,
		indexBaseYear: '2020',
		terminatedAt: null,
		terminatedBy: null,
		notes: null,
		...overrides.lease
	};
	// One batch, so a failed insert leaves nothing behind.
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
		...newLeaseStatements(db, context, [{ id: ids.leaseId, input }])
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
	return seedLease(db, { accountId: FOREIGN_ACCOUNT_ID, userId: null }, {});
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

async function clearTables(db: Database, accountId: string, body: Row): Promise<SeedResult> {
	if (!Array.isArray(body.tables) || !body.tables.every((name) => typeof name === 'string')) {
		return bad('Bitte gib die Tabellen als Liste von Namen an.');
	}
	// Every name is checked before anything is deleted, so a typo leaves the data as it was.
	const statements = [];
	for (const name of body.tables) {
		const table = findTable(name);
		if (!table) return bad(`Unbekannte Tabelle „${name}“.`);
		const { accountId: column } = getTableColumns(table);
		if (table === consumerPriceIndex) statements.push(db.delete(table));
		else if (!column) return bad(`Die Tabelle „${name}“ gehört zu keinem Konto.`);
		else statements.push(db.delete(table).where(eq(column, accountId)));
	}
	await runBatch(db, statements);
	return { status: 200, body: { cleared: body.tables } };
}

async function seedUser(db: Database, accountId: string, body: Row): Promise<SeedResult> {
	if (typeof body.email !== 'string' || !body.email.trim()) {
		return bad('Bitte gib eine E-Mail-Adresse an.');
	}
	if (typeof body.password !== 'string' || !body.password) return bad('Bitte gib ein Passwort an.');
	const role = userRoles.find((candidate) => candidate === body.role);
	if (!role) return bad('Die Rolle ist owner oder manager.');
	if (body.name !== undefined && body.name !== null && typeof body.name !== 'string') {
		return bad('Der Name ist ein Text.');
	}
	const email = normalizeEmail(body.email);
	const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
	if (taken) return bad(`Die E-Mail-Adresse ${email} ist schon vergeben.`);
	const [user] = await db
		.insert(users)
		.values({
			accountId,
			email,
			passwordHash: await hashPassword(body.password),
			role,
			name: body.name ?? null
		})
		.returning({ id: users.id });
	return { status: 200, body: { id: user.id } };
}

/** A session of a user of the owner's account, as signing in creates it; returns the cookie token. */
async function seedSession(db: Database, accountId: string, body: Row): Promise<SeedResult> {
	if (typeof body.userId !== 'string') return bad('Bitte gib die Id des Zugangs an.');
	const [user] = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.accountId, accountId), eq(users.id, body.userId)));
	if (!user) return bad('Diesen Zugang gibt es im Konto nicht.');
	const { token } = await createSession(db, user.id);
	return { status: 200, body: { token } };
}

/**
 * Runs one seed operation, chosen by `body.op`: `lease` (property, unit, tenant and a lease with
 * its initial rent and persons), `foreignLease` (the same in a second account no e2e user belongs
 * to, for the 404 checks), `rows` (raw rows of any table), `user` (a second user of the owner's
 * account), `session` (a signed-in browser of such a user) or `clear` (the owner's rows of the
 * given tables, all rows of the shared VPI table). Returns the HTTP status and body for the route.
 */
export async function seed(db: Database, body: unknown): Promise<SeedResult> {
	if (!isPlainObject(body)) return bad('Der Körper ist ein JSON-Objekt mit „op“.');
	const context = await ownerContext(db);
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
				return await seedLease(db, context, overrides);
			}
			case 'foreignLease':
				return await seedForeignLease(db);
			case 'rows':
				return await seedRows(db, context.accountId, body);
			case 'user':
				return await seedUser(db, context.accountId, body);
			case 'session':
				return await seedSession(db, context.accountId, body);
			case 'clear':
				return await clearTables(db, context.accountId, body);
			default:
				return bad(
					'Unbekannte Operation; erlaubt sind lease, foreignLease, rows, user, session und clear.'
				);
		}
	} catch (error) {
		// A constraint violation or a wrong value type; the message tells the test what went wrong.
		return {
			status: 500,
			body: { message: error instanceof Error ? error.message : String(error) }
		};
	}
}
