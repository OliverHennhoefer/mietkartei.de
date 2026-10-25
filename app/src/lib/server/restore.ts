import { and, count, eq, getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { chunk, rowsPerStatement, runBatch } from './db/batch';
import * as schema from './db/schema';
import { accounts, documents, leaseTenants, leases, properties, users } from './db/schema';
import { MAX_ACCOUNT_DOCUMENT_BYTES, MAX_ACCOUNT_DOCUMENTS, MAX_DOCUMENT_BYTES } from './documents';
import { EXPORT_FORMAT, EXPORT_VERSION, exportTables } from './export';
import { getStorage, storageKey, type Storage } from './storage';

// Restore (Export einspielen): fills an empty account with the export.json of another account,
// usually from another instance (moving from app.mietkartei.de to a self-hosted one or back).
// The rows keep their ids, take the account's id and point at the restoring owner where they
// pointed at the exported owner. The documents follow one request each (restoreDocument), so no
// request is larger than a document; the browser reads the ZIP and sends its parts.

/**
 * Rows that belong to people or sessions of the old instance, not to the landlord's data: users
 * (the restoring owner and their own logins stay), pending e-mail changes, invitations and
 * calendar feeds (their tokens are for the old address).
 */
const skippedTables = new Set<SQLiteTable>([
	schema.users,
	schema.emailChanges,
	schema.invitations,
	schema.calendarFeeds
]);

/** What is restored, parents before children, as exportTables lists them. */
export const restoredTables: SQLiteTable[] = exportTables.flatMap((table) => {
	if (skippedTables.has(table)) return [];
	return table === leases ? [table, leaseTenants] : [table];
});

/** The account fields that describe the landlord; billing and trial stay with this instance. */
const accountFields = [
	'name',
	'landlordName',
	'street',
	'postalCode',
	'city',
	'iban',
	'bankName',
	'operatingCostDefaultsSeeded'
] as const;

export type RestoreError = 'not-empty' | 'invalid' | 'quota' | 'rejected';

export type RestoreResult =
	{ ok: true; rows: number; documents: number } | { ok: false; reason: RestoreError };

type Row = Record<string, unknown>;

/** The columns of a table that point at a user, by their key in the row. */
function userColumns(table: SQLiteTable): Set<string> {
	const keys = new Set<string>();
	const columns = Object.entries(getTableColumns(table));
	for (const foreignKey of getTableConfig(table).foreignKeys) {
		const reference = foreignKey.reference();
		if (reference.foreignTable !== users) continue;
		for (const column of reference.columns) {
			const key = columns.find(([, candidate]) => candidate === column)?.[0];
			if (key) keys.add(key);
		}
	}
	return keys;
}

/**
 * One exported row as it is inserted here: only known columns, timestamps back to dates (JSON has
 * them as ISO strings), the account's id, users mapped, document keys for this account.
 */
function restoredRow(
	table: SQLiteTable,
	row: Row,
	accountId: string,
	mapUser: (id: unknown) => string | null
): Row {
	const columns = getTableColumns(table);
	const users = userColumns(table);
	const restored: Row = {};
	for (const [key, column] of Object.entries(columns)) {
		if (!(key in row)) continue;
		let value = row[key];
		if (key === 'accountId') value = accountId;
		else if (users.has(key)) value = mapUser(value);
		else if (column.columnType === 'SQLiteTimestamp' && value !== null) {
			value = new Date(value as string);
		}
		restored[key] = value;
	}
	if (table === documents) restored.storageKey = storageKey(accountId, String(row.id));
	return restored;
}

/**
 * The rows of a table that refers to itself (a reversal points at the charge it reverses) with
 * every referenced row before the rows that refer to it; other tables as they are.
 */
function parentsFirst(table: SQLiteTable, rows: Row[]): Row[] {
	const columns = Object.entries(getTableColumns(table));
	const keys = getTableConfig(table)
		.foreignKeys.map((foreignKey) => foreignKey.reference())
		.filter((reference) => reference.foreignTable === table)
		.flatMap((reference) => reference.columns)
		.map((column) => columns.find(([, candidate]) => candidate === column)?.[0])
		.filter((key) => key !== undefined);
	if (keys.length === 0) return rows;
	const byId = new Map(rows.map((row) => [row.id, row]));
	const sorted: Row[] = [];
	const placed = new Set<unknown>();
	const place = (row: Row, path: Set<unknown>) => {
		if (placed.has(row.id) || path.has(row.id)) return;
		path.add(row.id);
		for (const key of keys) {
			const parent = byId.get(row[key]);
			if (parent) place(parent, path);
		}
		placed.add(row.id);
		sorted.push(row);
	};
	for (const row of rows) place(row, new Set());
	return sorted;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether every reference of the restored rows stays inside them: a crafted export must not link
 * its rows to rows of another account on this instance (users are mapped, the account is this
 * one). Document ids also name files, so they must be UUIDs, never a path.
 */
function referencesStayInside(restored: Map<SQLiteTable, Row[]>): boolean {
	for (const [table, rows] of restored) {
		for (const foreignKey of getTableConfig(table).foreignKeys) {
			const reference = foreignKey.reference();
			if (reference.foreignTable === users || reference.foreignTable === accounts) continue;
			const parents = restored.get(reference.foreignTable) ?? [];
			for (const [index, column] of reference.columns.entries()) {
				const key = keyOf(table, column);
				const parentKey = keyOf(reference.foreignTable, reference.foreignColumns[index]);
				const allowed = new Set(parents.map((row) => row[parentKey]));
				for (const row of rows) {
					const value = row[key];
					if (value !== null && value !== undefined && !allowed.has(value)) return false;
				}
			}
		}
	}
	return (restored.get(documents) ?? []).every((row) => UUID.test(String(row.id)));
}

/** The key of a column in the rows of its table. */
function keyOf(table: SQLiteTable, column: unknown): string {
	const entry = Object.entries(getTableColumns(table)).find(
		([, candidate]) => candidate === column
	);
	if (!entry) throw new Error(`No column of ${getTableName(table)} matches the reference`);
	return entry[0];
}

function isRow(value: unknown): value is Row {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The tables of an export.json, or undefined when it is not one this version can read. */
function exportedTables(data: unknown): Record<string, unknown[]> | undefined {
	if (!isRow(data) || data.format !== EXPORT_FORMAT || data.version !== EXPORT_VERSION) {
		return undefined;
	}
	if (!isRow(data.tables)) return undefined;
	const tables: Record<string, unknown[]> = {};
	for (const [name, rows] of Object.entries(data.tables)) {
		if (!Array.isArray(rows) || !rows.every(isRow)) return undefined;
		tables[name] = rows;
	}
	return tables;
}

/** Whether nothing the landlord entered is in the account yet, so a restore loses nothing. */
export async function canRestore(db: Database, accountId: string): Promise<boolean> {
	const [propertyCount] = await db
		.select({ count: count() })
		.from(properties)
		.where(eq(properties.accountId, accountId));
	const [documentCount] = await db
		.select({ count: count() })
		.from(documents)
		.where(eq(documents.accountId, accountId));
	return propertyCount.count === 0 && documentCount.count === 0;
}

/**
 * Restores export.json (parsed) into the account of `context`, which must be empty (canRestore).
 * What the account holds already, such as seeded cost categories or tasks, is replaced, all in
 * one batch: a failure leaves the account as it was. Documents arrive without their files, which
 * restoreDocument stores afterwards.
 */
export async function restoreExport(
	db: Database,
	context: AuditContext,
	data: unknown
): Promise<RestoreResult> {
	const { accountId } = context;
	const tables = exportedTables(data);
	const [exportedAccount] = tables?.accounts ?? [];
	if (!tables || !isRow(exportedAccount)) return { ok: false, reason: 'invalid' };
	if (!(await canRestore(db, accountId))) return { ok: false, reason: 'not-empty' };

	const owners = new Set(
		(tables.users ?? [])
			.filter((user) => isRow(user) && user.role === 'owner')
			.map((user) => (user as Row).id)
	);
	// Managers of the old account do not exist here; what they did stays, without a name.
	const mapUser = (id: unknown) => (id !== null && owners.has(id) ? context.userId : null);

	const statements = [];
	// Children first, so no delete is refused by a reference.
	for (const table of [...restoredTables].reverse()) {
		if (table === leaseTenants) continue; // goes with its lease
		const column = getTableColumns(table).accountId;
		statements.push(db.delete(table).where(eq(column, accountId)));
	}

	const account: Row = {};
	for (const field of accountFields) {
		if (field in exportedAccount) account[field] = exportedAccount[field];
	}
	if (Object.keys(account).length > 0) {
		statements.push(db.update(accounts).set(account).where(eq(accounts.id, accountId)));
	}

	const restored = new Map<SQLiteTable, Row[]>();
	for (const table of restoredTables) {
		const rows = (tables[getTableName(table)] ?? []).map((row) =>
			restoredRow(table, row as Row, accountId, mapUser)
		);
		restored.set(table, parentsFirst(table, rows));
	}
	if (!referencesStayInside(restored)) return { ok: false, reason: 'invalid' };
	const restoredDocuments = restored.get(documents) ?? [];
	const documentBytes = restoredDocuments.reduce((total, row) => total + Number(row.size), 0);
	if (
		restoredDocuments.length > MAX_ACCOUNT_DOCUMENTS ||
		!(documentBytes <= MAX_ACCOUNT_DOCUMENT_BYTES)
	) {
		return { ok: false, reason: 'quota' };
	}

	let restoredRows = 0;
	for (const [table, rows] of restored) {
		restoredRows += rows.length;
		for (const group of chunk(rows, rowsPerStatement(table))) {
			statements.push(db.insert(table).values(group as never));
		}
	}
	statements.push(auditEntry(db, context, 'account', accountId, 'import', 'Export eingespielt'));

	try {
		await runBatch(db, statements as Parameters<typeof runBatch>[1]);
	} catch {
		// Rows that do not fit this schema, or ids that exist already (the exported account is
		// still on this instance).
		return { ok: false, reason: 'rejected' };
	}
	return { ok: true, rows: restoredRows, documents: restoredDocuments.length };
}

export type DocumentRestoreError = 'unknown' | 'size' | 'exists';

/**
 * Stores the file of a restored document: the bytes must have the size its row records, and the
 * document must not have a file yet, so a restore cannot overwrite what is there.
 */
export async function restoreDocument(
	db: Database,
	accountId: string,
	documentId: string,
	bytes: Uint8Array,
	options?: { storage?: Storage }
): Promise<{ ok: true } | { ok: false; reason: DocumentRestoreError }> {
	const [document] = await db
		.select({ size: documents.size, mimeType: documents.mimeType, key: documents.storageKey })
		.from(documents)
		.where(and(eq(documents.id, documentId), eq(documents.accountId, accountId)));
	if (!document) return { ok: false, reason: 'unknown' };
	if (bytes.byteLength !== document.size || bytes.byteLength > MAX_DOCUMENT_BYTES) {
		return { ok: false, reason: 'size' };
	}
	const storage = options?.storage ?? (await getStorage());
	const existing = await storage.get(document.key);
	if (existing) {
		await existing.body.cancel();
		return { ok: false, reason: 'exists' };
	}
	await storage.put(document.key, bytes, document.mimeType);
	return { ok: true };
}
