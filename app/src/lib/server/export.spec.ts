import { eq, getTableName } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from './db';
import { auditLog, leaseTenants } from './db/schema';
import { storeDocument } from './documents';
import {
	accountTables,
	collectExport,
	documentPath,
	exportTables,
	exportZip,
	type ExportData
} from './export';
import { createPayment, ensureCharges } from './ledger';
import { createLease } from './leases';
import { openFileStorage } from './storage/fs';
import type { Storage } from './storage';
import { contextA, contextB, leaseInput, seedTenant, seedUnit, testDatabase } from './testing';

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
	const created = await createLease(db, context, leaseInput(unitId, { tenantIds: [tenantId] }));
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
		const listed = exportTables.map(getTableName).sort();
		const expected = accountTables().map(getTableName).sort();
		expect(listed).toEqual(expected);
		expect(new Set(listed).size).toBe(listed.length);
	});

	it('lists parents before children', () => {
		const names = exportTables.map(getTableName);
		const before = (parent: string, child: string) =>
			expect(names.indexOf(parent)).toBeLessThan(names.indexOf(child));
		before('properties', 'units');
		before('units', 'leases');
		before('leases', 'rent_charges');
		before('leases', 'payments');
		before('bank_accounts', 'bank_transactions');
		before('cost_categories', 'cost_items');
		before('allocation_keys', 'cost_items');
		before('meters', 'meter_readings');
		before('operating_cost_statements', 'statement_results');
	});
});

describe('collectExport', () => {
	it('exports every row of the account, users without their hash, and the join rows', async () => {
		const own = await seedAccount(contextA);
		await seedAccount(contextB);

		const data = await collectExport(db, 'a');
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
});

/** The whole archive the stream yields, as the browser receives it. */
async function readZip(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function exportEntries(): Promise<string[]> {
	const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'export'));
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
			['export.json', 'documents/', `documents/${stored.id}-Mietvertrag.pdf`].sort()
		);
		expect(strFromU8(files[`documents/${stored.id}-Mietvertrag.pdf`])).toBe('%PDF-1.4 test');

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
		).toEqual([['a', 'user-a', 'account', 'Alle Daten als ZIP-Datei exportiert']]);
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
		const empty = await exportZip(db, contextB, { storage });
		const queriesWithout = selects.mock.calls.length;
		selects.mockClear();
		const stream = await exportZip(db, contextA, { storage: watched });
		expect(selects.mock.calls.length).toBe(queriesWithout);
		selects.mockRestore();
		await empty.cancel();

		// Nothing is read or logged before the reader pulls.
		expect(keys).toEqual([]);
		expect(await exportEntries()).toEqual([]);
		const files = unzipSync(await readZip(stream));
		expect(keys.sort()).toEqual(ids.map((id) => `a/${id}`).sort());
		expect(strFromU8(files[`documents/${ids[1]}-Zwei.pdf`])).toBe('Zwei.pdf');
		expect(await exportEntries()).toEqual(['Alle Daten als ZIP-Datei exportiert']);
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
		expect(await exportEntries()).toEqual([]);
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
