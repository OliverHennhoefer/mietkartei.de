import { eq, getTableColumns, getTableName, inArray, is } from 'drizzle-orm';
import { SQLiteTable, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { logChange, type AuditContext } from './audit';
import type { Database } from './db';
import * as schema from './db/schema';
import { accounts, leaseTenants, leases, users } from './db/schema';
import { listDocuments, openDocument } from './documents';
import type { Storage } from './storage';

// Export (Alle Daten herunterladen): a ZIP with export.json, every table of the account as an
// array of rows keyed by the SQL table name, and the uploaded documents. Parents come before
// children, so a reader can re-create the rows in order. Nothing imports this file; it is the
// landlord's copy of their data (Datenportabilität).

export const EXPORT_FORMAT = 'mietkartei';
export const EXPORT_VERSION = 1;

type AccountTable = SQLiteTable & { accountId: SQLiteColumn };

/**
 * Every table with an accountId column, parents before children. The spec checks that no table
 * of the schema is missing here, so a new table cannot be forgotten.
 */
export const exportTables: AccountTable[] = [
	schema.users,
	schema.invitations,
	schema.auditLog,
	schema.properties,
	schema.units,
	schema.tenants,
	schema.leases,
	schema.leaseUnits,
	schema.leasePersons,
	schema.rentChanges,
	schema.depositTransactions,
	schema.consumerPriceIndex,
	schema.rentCharges,
	schema.bankAccounts,
	schema.bankImports,
	schema.bankTransactions,
	schema.payments,
	schema.matchingRules,
	schema.allocationKeys,
	schema.allocationKeyShares,
	schema.billingCircles,
	schema.billingCircleUnits,
	schema.costCategories,
	schema.costItems,
	schema.costItemUnitAmounts,
	schema.meters,
	schema.meterReadings,
	schema.operatingCostStatements,
	schema.statementResults,
	schema.co2CostSplits,
	schema.documents,
	schema.tasks
];

/** The tables of the schema that carry an accountId column, for the completeness check. */
export function accountTables(): AccountTable[] {
	return (Object.values(schema) as unknown[]).filter(
		(value): value is AccountTable =>
			is(value, SQLiteTable) && 'accountId' in getTableColumns(value)
	);
}

export type ExportData = {
	format: typeof EXPORT_FORMAT;
	version: typeof EXPORT_VERSION;
	exportedAt: string;
	accountId: string;
	/** Rows per SQL table name, in dependency order; `accounts` holds the one account row. */
	tables: Record<string, Record<string, unknown>[]>;
};

/** Reads every table of the account: one query per table, none per row. */
export async function collectExport(db: Database, accountId: string): Promise<ExportData> {
	const tables: ExportData['tables'] = {};
	tables[getTableName(accounts)] = await db
		.select()
		.from(accounts)
		.where(eq(accounts.id, accountId));
	for (const table of exportTables) {
		const rows = await db.select().from(table).where(eq(table.accountId, accountId));
		tables[getTableName(table)] =
			table === users ? rows.map((row) => withoutPasswordHash(row)) : rows;
		if (table === leases) {
			// The one join table without an accountId column goes by the account's leases.
			tables[getTableName(leaseTenants)] = await db
				.select()
				.from(leaseTenants)
				.where(
					inArray(
						leaseTenants.leaseId,
						db.select({ id: leases.id }).from(leases).where(eq(leases.accountId, accountId))
					)
				);
		}
	}
	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		accountId,
		tables
	};
}

function withoutPasswordHash(row: Record<string, unknown>): Record<string, unknown> {
	const rest = { ...row };
	delete rest.passwordHash;
	return rest;
}

/** `documents/<id>-<name>`, with anything a file system would mind replaced. */
export function documentPath(document: { id: string; name: string }): string {
	// Path separators, Windows' reserved characters and control characters become underscores.
	const name =
		Array.from(document.name, (char) =>
			char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? '_' : char
		)
			.join('')
			.trim() || 'Dokument';
	return `documents/${document.id}-${name}`;
}

/**
 * Builds the ZIP: export.json plus one file per document whose object still exists (a document
 * without an object stays in the JSON only). Bodies are read into memory, which is what fflate
 * needs and fine for documents of at most 10 MB. Logged as an export of the account.
 */
export async function buildExportZip(
	db: Database,
	context: AuditContext,
	options?: { storage?: Storage }
): Promise<Uint8Array> {
	await logChange(
		db,
		context,
		'account',
		context.accountId,
		'export',
		'Alle Daten als ZIP-Datei exportiert'
	);
	const data = await collectExport(db, context.accountId);
	const files: Zippable = {
		'export.json': strToU8(JSON.stringify(data, null, '\t')),
		'documents/': new Uint8Array(0)
	};
	for (const document of await listDocuments(db, context.accountId)) {
		const opened = await openDocument(db, context.accountId, document.id, options);
		if (!opened) continue;
		files[documentPath(document)] = new Uint8Array(await new Response(opened.body).arrayBuffer());
	}
	return zipSync(files, { level: 6 });
}
