import {
	and,
	eq,
	getTableColumns,
	getTableName,
	gt,
	inArray,
	is,
	sql,
	type SQL
} from 'drizzle-orm';
import { SQLiteTable, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import * as schema from './db/schema';
import { accounts, auditLog, leaseTenants, leases, users } from './db/schema';
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
 * of the schema is missing here or in unexportedTables, so a new table cannot be forgotten.
 */
export const exportTables: AccountTable[] = [
	schema.users,
	schema.emailChanges,
	schema.invitations,
	schema.auditLog,
	schema.calendarFeeds,
	schema.properties,
	schema.units,
	schema.tenants,
	schema.leases,
	schema.leaseUnits,
	schema.leasePersons,
	schema.rentChanges,
	schema.depositTransactions,
	schema.rentCharges,
	schema.bankAccounts,
	schema.bankImports,
	schema.bankTransactions,
	schema.payments,
	schema.paymentReminders,
	schema.expenses,
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
	schema.tasks,
	schema.insurancePolicies,
	schema.associationStatements
];

/**
 * Tables with an accountId column that stay out of the export: API keys are credentials, not the
 * landlord's data, and even their hashes have no use outside this instance.
 */
export const unexportedTables: AccountTable[] = [schema.apiKeys];

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

/** Rows per query: export.json is written a page at a time, never held whole. */
export const EXPORT_PAGE_ROWS = 1000;

/** What one table contributes to export.json. */
type Source = {
	table: SQLiteTable;
	where: SQL;
	/**
	 * The column the table's account index sorts by after the account, if any. Pages follow the
	 * index (by it, then rowid), so each page is one index range, not a sort of all the rows.
	 */
	sortedBy?: SQLiteColumn;
};

function exportSources(db: Database, accountId: string): Source[] {
	const sources: Source[] = [{ table: accounts, where: eq(accounts.id, accountId) }];
	for (const table of exportTables) {
		sources.push({
			table,
			where: eq(table.accountId, accountId),
			sortedBy: table === auditLog ? auditLog.at : undefined
		});
		if (table === leases) {
			// The one join table without an accountId column goes by the account's leases.
			sources.push({
				table: leaseTenants,
				where: inArray(
					leaseTenants.leaseId,
					db.select({ id: leases.id }).from(leases).where(eq(leases.accountId, accountId))
				)
			});
		}
	}
	return sources;
}

/** The rows of one source, EXPORT_PAGE_ROWS at a time, keyset-paged by rowid. */
async function* pages(db: Database, source: Source): AsyncGenerator<Record<string, unknown>[]> {
	const { table, where, sortedBy } = source;
	const rowid = sql<number>`${table}.rowid`;
	// The raw value, so it can be bound again as it is stored.
	const sortKey = sortedBy ? sql<unknown>`${sortedBy}` : undefined;
	let after: SQL | undefined;
	for (;;) {
		const rows = await db
			.select({ row: getTableColumns(table), rowid, sortKey: sortKey ?? rowid })
			.from(table)
			.where(after ? and(where, after) : where)
			.orderBy(...(sortedBy ? [sortedBy, rowid] : [rowid]))
			.limit(EXPORT_PAGE_ROWS);
		if (rows.length === 0) return;
		yield rows.map(({ row }) => row as Record<string, unknown>);
		if (rows.length < EXPORT_PAGE_ROWS) return;
		const last = rows[rows.length - 1];
		after = sortedBy
			? sql`(${sortedBy}, ${rowid}) > (${last.sortKey}, ${last.rowid})`
			: gt(rowid, last.rowid);
	}
}

/**
 * export.json (see ExportData) as text pieces, one per page of rows: every table of the account,
 * users without their password hash. Compact, so a reader takes it as it comes.
 */
export async function* exportJson(db: Database, accountId: string): AsyncGenerator<string> {
	const head = {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		accountId
	};
	yield `${JSON.stringify(head).slice(0, -1)},"tables":{`;
	let tableSeparator = '';
	for (const source of exportSources(db, accountId)) {
		yield `${tableSeparator}${JSON.stringify(getTableName(source.table))}:[`;
		tableSeparator = ',';
		let rowSeparator = '';
		for await (const rows of pages(db, source)) {
			const exported = source.table === users ? rows.map(withoutPasswordHash) : rows;
			yield rowSeparator + exported.map((row) => JSON.stringify(row)).join(',');
			rowSeparator = ',';
		}
		yield ']';
	}
	yield '}}';
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
 * in the JSON only. The document rows are listed up front (one query, no lookup per document);
 * everything else is read while the reader pulls, one piece at a time: a page of rows for
 * export.json (EXPORT_PAGE_ROWS), then a chunk of a document. So memory stays at about one page
 * or chunk however large the account is. The export is logged once the last file is in, so an
 * export that fails part-way is not logged as done.
 */
export async function exportZip(
	db: Database,
	context: AuditContext,
	options?: { storage?: Storage }
): Promise<ReadableStream<Uint8Array>> {
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
	const pieces = exportJson(db, context.accountId);
	let writingJson = true;

	let next = 0;
	let current:
		{ file: ZipPassThrough; reader: ReadableStreamDefaultReader<Uint8Array> } | undefined;

	/**
	 * Adds the next piece: a page of export.json, a chunk of the current document, the next
	 * document, or the end.
	 */
	async function step(): Promise<void> {
		if (writingJson) {
			const { done, value } = await pieces.next();
			if (!done) {
				json.push(strToU8(value));
				return;
			}
			json.push(new Uint8Array(0), true);
			writingJson = false;
			const folder = new ZipPassThrough('documents/');
			zip.add(folder);
			folder.push(new Uint8Array(0), true);
			return;
		}
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

	return new ReadableStream<Uint8Array>(
		{
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
				await pieces.return(undefined);
				await current?.reader.cancel(reason);
				zip.terminate();
			}
		},
		// No read ahead: pull runs only when the reader asks.
		{ highWaterMark: 0 }
	);
}
