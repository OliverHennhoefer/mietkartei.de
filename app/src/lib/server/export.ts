import { eq, getTableColumns, getTableName, inArray, is } from 'drizzle-orm';
import { SQLiteTable, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import * as schema from './db/schema';
import { accounts, leaseTenants, leases, users } from './db/schema';
import { listDocuments } from './documents';
import { getStorage, type Storage } from './storage';

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
	schema.emailChanges,
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
 * The ZIP as a stream: export.json (deflated) plus one file per document whose object still
 * exists, stored as it is (PDFs and scans do not compress). A document without an object stays
 * in the JSON only. The documents are read one chunk at a time while the reader pulls, so memory
 * stays at about one chunk however large the account is, and they come from the listed rows
 * (one query) without a lookup per document. The export is logged once the last file is in, so
 * an export that fails part-way is not logged as done.
 */
export async function exportZip(
	db: Database,
	context: AuditContext,
	options?: { storage?: Storage }
): Promise<ReadableStream<Uint8Array>> {
	const data = await collectExport(db, context.accountId);
	const rows = await listDocuments(db, context.accountId);
	const storage = options?.storage ?? (await getStorage());

	// fflate calls back synchronously with every piece of the archive it has written.
	const pending: Uint8Array[] = [];
	let finished = false;
	let failure: Error | undefined;
	const zip = new Zip((error, piece, final) => {
		if (error) failure = error;
		else pending.push(piece);
		if (final) finished = true;
	});
	const json = new ZipDeflate('export.json', { level: 6 });
	zip.add(json);
	json.push(strToU8(JSON.stringify(data, null, '\t')), true);
	const folder = new ZipPassThrough('documents/');
	zip.add(folder);
	folder.push(new Uint8Array(0), true);

	let next = 0;
	let current:
		{ file: ZipPassThrough; reader: ReadableStreamDefaultReader<Uint8Array> } | undefined;

	/** Adds the next piece: a chunk of the current document, the next document, or the end. */
	async function step(): Promise<void> {
		if (current) {
			const { done, value } = await current.reader.read();
			if (done) {
				current.file.push(new Uint8Array(0), true);
				current = undefined;
			} else {
				current.file.push(value);
			}
			return;
		}
		if (next < rows.length) {
			const document = rows[next++];
			const object = await storage.get(document.storageKey);
			if (!object) return;
			const file = new ZipPassThrough(documentPath(document));
			zip.add(file);
			current = { file, reader: object.body.getReader() };
			return;
		}
		await auditEntry(
			db,
			context,
			'account',
			context.accountId,
			'export',
			'Alle Daten als ZIP-Datei exportiert'
		);
		zip.end();
	}

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			while (pending.length === 0 && !finished && !failure) await step();
			if (failure) {
				controller.error(failure);
				return;
			}
			for (const piece of pending.splice(0)) controller.enqueue(piece);
			if (finished) controller.close();
		},
		async cancel(reason) {
			await current?.reader.cancel(reason);
			zip.terminate();
		}
	});
}
