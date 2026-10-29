import { and, eq, getTableName } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from './db';
import { chunk, rowsPerStatement } from './db/batch';
import { auditLog, leaseTenants, properties } from './db/schema';
import { storeDocument } from './documents';
import {
	EXPORT_PAGE_ROWS,
	MISSING_DOCUMENTS_FILE,
	accountTables,
	documentPath,
	exportJson,
	exportTables,
	exportZip,
	unexportedTables,
	type ExportData
} from './export';
import { createPayment, ensureCharges } from './ledger';
import { openFileStorage } from './storage/fs';
import type { Storage } from './storage';
import {
	contextA,
	contextB,
	createLeaseWithoutCharges,
	leaseInput,
	seedTenant,
	seedUnit,
	testDatabase
} from './testing';

let db: Database;
let root: string;
let storage: Storage;

beforeEach(async () => {
	db = await testDatabase();
	root = await mkdtemp(join(tmpdir(), 'mietkartei-export-'));
	storage = openFileStorage(root);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

/** A lease with a tenant, three rent charges and a payment, in the given account. */
async function seedAccount(context: typeof contextA) {
	const { propertyId, unitId } = await seedUnit(db, context.accountId);
	const tenantId = await seedTenant(db, context.accountId);
	const created = await createLeaseWithoutCharges(
		db,
		context,
		leaseInput(unitId, { tenantIds: [tenantId] })
	);
	if (!created.ok) throw new Error(created.reason);
	await ensureCharges(db, context.accountId, [created.id], '2025-03');
	await createPayment(db, context, {
		leaseId: created.id,
		amount: 80000,
		date: '2025-01-03',
		source: 'manual',
		note: null
	});
	return { propertyId, unitId, tenantId, leaseId: created.id };
}

describe('exportTables', () => {
	it('names every table of the schema that belongs to an account, each once', () => {
		const listed = [...exportTables, ...unexportedTables].map(getTableName).sort();
		const expected = accountTables().map(getTableName).sort();
		expect(listed).toEqual(expected);
		expect(new Set(listed).size).toBe(listed.length);
	});

	it('lists parents before children', () => {
		const names = exportTables.map(getTableName);
		for (const table of exportTables) {
			for (const foreignKey of getTableConfig(table).foreignKeys) {
				const parent = getTableName(foreignKey.reference().foreignTable);
				if (!names.includes(parent) || parent === getTableName(table)) continue;
				expect(names.indexOf(parent), `${getTableName(table)} → ${parent}`).toBeLessThan(
					names.indexOf(getTableName(table))
				);
			}
		}
	});
});

/** export.json of the account, put together from its pieces. */
async function collect(accountId: string): Promise<ExportData> {
	let text = '';
	for await (const piece of exportJson(db, accountId)) text += piece;
	return JSON.parse(text) as ExportData;
}

describe('exportJson', () => {
	it('exports every row of the account, users without their hash, and the join rows', async () => {
		const own = await seedAccount(contextA);
		await seedAccount(contextB);

		const data = await collect('a');
		expect(data).toMatchObject({ format: 'mietkartei', version: 1, accountId: 'a' });
		expect(Date.parse(data.exportedAt)).not.toBeNaN();
		// The account row first, then the tables in dependency order.
		expect(Object.keys(data.tables).slice(0, 5)).toEqual([
			'accounts',
			'users',
			'email_changes',
			'invitations',
			'audit_log'
		]);
		expect(data.tables.accounts).toEqual([expect.objectContaining({ id: 'a', name: 'Konto A' })]);
		expect(data.tables.users).toEqual([
			expect.objectContaining({ id: 'user-a', email: 'a@example.org', role: 'owner' })
		]);
		expect(data.tables.users[0]).not.toHaveProperty('passwordHash');
		expect(data.tables.properties).toEqual([expect.objectContaining({ id: own.propertyId })]);
		expect(data.tables.units).toEqual([expect.objectContaining({ id: own.unitId })]);
		expect(data.tables.tenants).toEqual([expect.objectContaining({ id: own.tenantId })]);
		expect(data.tables.leases).toEqual([expect.objectContaining({ id: own.leaseId })]);
		expect(data.tables.lease_tenants).toEqual([{ leaseId: own.leaseId, tenantId: own.tenantId }]);
		// January to March 2025 at 600 + 150 + 50 € = 800,00 € each, and the one payment of 800,00 €.
		expect(data.tables.rent_charges.map((row) => [row.period, row.amount])).toEqual([
			['2025-01', 80000],
			['2025-02', 80000],
			['2025-03', 80000]
		]);
		expect(data.tables.payments).toEqual([expect.objectContaining({ amount: 80000 })]);
		expect(data.tables.rent_changes).toEqual([
			expect.objectContaining({ leaseId: own.leaseId, baseRent: 60000, reason: 'initial' })
		]);
		expect(data.tables.lease_persons).toHaveLength(1);
		expect(data.tables.documents).toEqual([]);
		expect(data.tables.tasks).toEqual([]);
		expect(Object.keys(data.tables)).toHaveLength(exportTables.length + 2);

		// Nothing of account b: every row with an accountId says a, every join row is a's.
		for (const [name, rows] of Object.entries(data.tables)) {
			for (const row of rows) {
				if ('accountId' in row) expect(row.accountId, name).toBe('a');
			}
		}
		expect(await db.select().from(leaseTenants)).toHaveLength(2);
	});

	it('reads large tables a page at a time, every row once and in order', async () => {
		// Two pages and one row of properties (by rowid), between those of account b, and of log
		// entries, which follow their index (by time, then rowid); the first half of the entries
		// share one time across the page border.
		const count = 2 * EXPORT_PAGE_ROWS + 1;
		const propertyRows = Array.from({ length: count + EXPORT_PAGE_ROWS }, (_, index) => ({
			accountId: index % 3 === 2 ? 'b' : 'a',
			name: `Haus ${index}`,
			street: 'Lindenstraße 4',
			postalCode: '10115',
			city: 'Berlin'
		}));
		for (const group of chunk(propertyRows, rowsPerStatement(properties))) {
			await db.insert(properties).values(group);
		}
		const logRows = Array.from({ length: count }, (_, index) => ({
			accountId: 'a',
			entity: 'property',
			entityId: `p${index}`,
			action: 'create',
			summary: `Eintrag ${index}`,
			at: new Date(Date.UTC(2025, 0, 1) + (index < count / 2 ? 0 : index * 1000))
		}));
		for (const group of chunk(logRows, rowsPerStatement(auditLog))) {
			await db.insert(auditLog).values(group);
		}

		const selects = vi.spyOn(db, 'select');
		const data = await collect('a');
		const pagesRead = selects.mock.calls.length;
		selects.mockRestore();

		const ownProperties = propertyRows.filter((row) => row.accountId === 'a');
		expect(data.tables.properties.map((row) => row.name)).toEqual(
			ownProperties.map((row) => row.name)
		);
		expect(data.tables.audit_log.map((row) => row.summary)).toEqual(
			logRows.map((row) => row.summary)
		);
		// One query per table (and the account, the join rows and their leases), two more each for
		// the large ones.
		expect(ownProperties).toHaveLength(count);
		expect(pagesRead).toBe(exportTables.length + 2 + 1 + 2 * 2);
	});
});

/** The whole archive the stream yields, as the browser receives it. */
async function readZip(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function exportEntries(accountId: string): Promise<string[]> {
	const audit = await db
		.select()
		.from(auditLog)
		.where(and(eq(auditLog.accountId, accountId), eq(auditLog.action, 'export')));
	return audit.map((entry) => entry.summary);
}

describe('exportZip', () => {
	it('zips export.json with the documents and logs the export', async () => {
		const { leaseId } = await seedAccount(contextA);
		const stored = await storeDocument(
			db,
			contextA,
			{
				name: 'Mietvertrag.pdf',
				mimeType: 'application/pdf',
				bytes: new TextEncoder().encode('%PDF-1.4 test'),
				links: { leaseId }
			},
			{ storage }
		);
		if (!stored.ok) throw new Error(stored.reason);
		const lost = await storeDocument(
			db,
			contextA,
			{ name: 'Weg.pdf', mimeType: 'application/pdf', bytes: new TextEncoder().encode('x') },
			{ storage }
		);
		if (!lost.ok) throw new Error(lost.reason);
		await storage.delete(`a/${lost.id}`);
		const foreign = await storeDocument(
			db,
			contextB,
			{ name: 'Fremd.pdf', mimeType: 'application/pdf', bytes: new TextEncoder().encode('b') },
			{ storage }
		);
		if (!foreign.ok) throw new Error(foreign.reason);

		const files = unzipSync(await readZip(await exportZip(db, contextA, { storage })));
		expect(Object.keys(files).sort()).toEqual(
			[
				'export.json',
				'documents/',
				`documents/${stored.id}-Mietvertrag.pdf`,
				MISSING_DOCUMENTS_FILE
			].sort()
		);
		expect(strFromU8(files[`documents/${stored.id}-Mietvertrag.pdf`])).toBe('%PDF-1.4 test');
		// The lost file is named in the archive, so the gap shows now and not when it is needed.
		expect(strFromU8(files[MISSING_DOCUMENTS_FILE])).toContain(`Weg.pdf (${lost.id})`);

		const data = JSON.parse(strFromU8(files['export.json'])) as ExportData;
		expect(data.accountId).toBe('a');
		expect(data.tables.documents.map((row) => row.name).sort()).toEqual([
			'Mietvertrag.pdf',
			'Weg.pdf'
		]);
		// JSON keeps the dates readable: timestamps become ISO strings.
		expect(typeof data.tables.users[0].createdAt).toBe('string');

		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'export'));
		expect(
			audit.map((entry) => [entry.accountId, entry.userId, entry.entity, entry.summary])
		).toEqual([
			[
				'a',
				'user-a',
				'account',
				'Alle Daten als ZIP-Datei exportiert (1 Dokument ohne Datei im Speicher)'
			]
		]);
		// Logged once the archive was complete, so the entry is not part of the exported log.
		expect(data.tables.audit_log.some((row) => row.action === 'export')).toBe(false);
	});

	it('reads the documents only while the archive is read, from the listed rows', async () => {
		const ids: string[] = [];
		for (const name of ['Eins.pdf', 'Zwei.pdf', 'Drei.pdf']) {
			const stored = await storeDocument(
				db,
				contextA,
				{ name, mimeType: 'application/pdf', bytes: new TextEncoder().encode(name) },
				{ storage }
			);
			if (!stored.ok) throw new Error(stored.reason);
			ids.push(stored.id);
		}
		const keys: string[] = [];
		const watched: Storage = {
			...storage,
			get(key) {
				keys.push(key);
				return storage.get(key);
			}
		};
		// The same number of queries with three documents as without any: no lookup per document.
		const selects = vi.spyOn(db, 'select');
		await readZip(await exportZip(db, contextB, { storage }));
		const queriesWithout = selects.mock.calls.length;
		selects.mockClear();
		const stream = await exportZip(db, contextA, { storage: watched });
		// Only the document list before the reader pulls: no row of export.json, no object, no log.
		expect(selects.mock.calls.length).toBe(1);
		expect(keys).toEqual([]);
		expect(await exportEntries('a')).toEqual([]);
		selects.mockClear();
		const files = unzipSync(await readZip(stream));
		expect(selects.mock.calls.length).toBe(queriesWithout - 1);
		selects.mockRestore();
		expect(keys.sort()).toEqual(ids.map((id) => `a/${id}`).sort());
		expect(strFromU8(files[`documents/${ids[1]}-Zwei.pdf`])).toBe('Zwei.pdf');
		expect(await exportEntries('a')).toEqual(['Alle Daten als ZIP-Datei exportiert']);
	});

	it('does not log an export that fails part-way', async () => {
		const stored = await storeDocument(
			db,
			contextA,
			{ name: 'Kaputt.pdf', mimeType: 'application/pdf', bytes: new TextEncoder().encode('x') },
			{ storage }
		);
		if (!stored.ok) throw new Error(stored.reason);
		const broken: Storage = {
			...storage,
			async get() {
				const body = new ReadableStream<Uint8Array>({
					pull(controller) {
						controller.error(new Error('R2 nicht erreichbar'));
					}
				});
				return { body, contentType: 'application/pdf', size: 1 };
			}
		};
		await expect(readZip(await exportZip(db, contextA, { storage: broken }))).rejects.toThrow(
			'R2 nicht erreichbar'
		);
		expect(await exportEntries('a')).toEqual([]);
	});

	it('stops reading the open document when the download is cancelled, without logging', async () => {
		const stored = await storeDocument(
			db,
			contextA,
			{ name: 'Groß.pdf', mimeType: 'application/pdf', bytes: new TextEncoder().encode('x') },
			{ storage }
		);
		if (!stored.ok) throw new Error(stored.reason);
		const cancelled = vi.fn();
		const endless: Storage = {
			...storage,
			async get() {
				const body = new ReadableStream<Uint8Array>({
					pull(controller) {
						controller.enqueue(new Uint8Array(1024));
					},
					cancel: cancelled
				});
				return { body, contentType: 'application/pdf', size: Infinity };
			}
		};
		const reader = (await exportZip(db, contextA, { storage: endless })).getReader();
		// Read until the document is open and streaming, then give up on the download.
		let bytes = 0;
		while (bytes < 64 * 1024) bytes += (await reader.read()).value?.length ?? 0;
		await reader.cancel('abgebrochen');
		expect(cancelled).toHaveBeenCalledWith('abgebrochen');
		expect(await exportEntries('a')).toEqual([]);
	});

	it('builds a ZIP for an empty account', async () => {
		const files = unzipSync(await readZip(await exportZip(db, contextB, { storage })));
		expect(Object.keys(files).sort()).toEqual(['documents/', 'export.json']);
		const data = JSON.parse(strFromU8(files['export.json'])) as ExportData;
		expect(data.tables.properties).toEqual([]);
	});
});

describe('documentPath', () => {
	it('keeps the id and name and replaces path characters', () => {
		expect(documentPath({ id: 'd1', name: 'Beleg 2025.pdf' })).toBe('documents/d1-Beleg 2025.pdf');
		expect(documentPath({ id: 'd2', name: '../etc/passwd' })).toBe('documents/d2-.._etc_passwd');
		expect(documentPath({ id: 'd3', name: '   ' })).toBe('documents/d3-Dokument');
	});
});
