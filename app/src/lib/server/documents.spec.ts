import { eq } from 'drizzle-orm';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { chunk, rowsPerStatement } from './db/batch';
import { allocationKeys, auditLog, costCategories, costItems, documents } from './db/schema';
import {
	MAX_DOCUMENT_BYTES,
	deleteAllDocuments,
	deleteDocument,
	getDocument,
	listDocuments,
	openDocument,
	storeDocument
} from './documents';
import { createLease } from './leases';
import { openFileStorage } from './storage/fs';
import type { Storage } from './storage';
import { contextA, contextB, leaseInput, seedTenant, seedUnit, testDatabase } from './testing';

let db: Database;
let root: string;
let storage: Storage;

beforeEach(async () => {
	db = await testDatabase();
	root = await mkdtemp(join(tmpdir(), 'mietkartei-documents-'));
	storage = openFileStorage(root);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);
const pdf = { name: 'Mietvertrag.pdf', mimeType: 'application/pdf', bytes: bytes('%PDF-1.4 test') };

/** Every file below the storage root, as paths relative to it. */
async function storedFiles(): Promise<string[]> {
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
		.sort();
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false
	);
}

async function readBody(body: ReadableStream): Promise<string> {
	return new TextDecoder().decode(await new Response(body).arrayBuffer());
}

/** A cost item with the category and key it needs; returns its id. */
async function seedCostItem(db: Database, accountId: string, propertyId: string) {
	const [category] = await db
		.insert(costCategories)
		.values({ accountId, name: 'Grundsteuer', betrkvItem: 1 })
		.returning({ id: costCategories.id });
	const [key] = await db
		.insert(allocationKeys)
		.values({ accountId, name: 'Wohnfläche', kind: 'area' })
		.returning({ id: allocationKeys.id });
	const [item] = await db
		.insert(costItems)
		.values({
			accountId,
			propertyId,
			categoryId: category.id,
			allocationKeyId: key.id,
			description: 'Grundsteuer 2025',
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			amount: 48000
		})
		.returning({ id: costItems.id });
	return item.id;
}

async function store(context: typeof contextA, input: Partial<typeof pdf> & { links?: object }) {
	const result = await storeDocument(db, context, { ...pdf, ...input }, { storage });
	if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
	return result.id;
}

describe('storeDocument', () => {
	it('stores the bytes, the row with its links and an audit line', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'a');
		const tenantId = await seedTenant(db, 'a');
		const lease = await createLease(db, contextA, leaseInput(unitId, { tenantIds: [tenantId] }));
		if (!lease.ok) throw new Error('setup failed');
		const costItemId = await seedCostItem(db, 'a', propertyId);

		const result = await storeDocument(
			db,
			contextA,
			{
				...pdf,
				name: '  Mietvertrag.pdf ',
				links: { propertyId, unitId, leaseId: lease.id, tenantId, costItemId }
			},
			{ storage }
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(await getDocument(db, 'a', result.id)).toMatchObject({
			accountId: 'a',
			name: 'Mietvertrag.pdf',
			mimeType: 'application/pdf',
			size: pdf.bytes.byteLength,
			storageKey: `a/${result.id}`,
			propertyId,
			unitId,
			leaseId: lease.id,
			tenantId,
			costItemId,
			uploadedBy: 'user-a'
		});
		expect(await storedFiles()).toEqual([`a/${result.id}`, `a/${result.id}.type`]);
		expect(await readFile(join(root, 'a', result.id), 'utf8')).toBe('%PDF-1.4 test');
		expect(await readFile(join(root, 'a', `${result.id}.type`), 'utf8')).toBe('application/pdf');

		// The lease logged its own creation; the upload is the only document entry.
		const audit = await db.select().from(auditLog).where(eq(auditLog.entity, 'document'));
		expect(
			audit.map((entry) => [entry.accountId, entry.entityId, entry.action, entry.summary])
		).toEqual([['a', result.id, 'upload', 'Dokument Mietvertrag.pdf hochgeladen']]);
	});

	it('falls back to a generic name and type and cuts the name at 200 characters', async () => {
		const unnamed = await store(contextA, { name: '   ', mimeType: '' });
		expect(await getDocument(db, 'a', unnamed)).toMatchObject({
			name: 'Dokument',
			mimeType: 'application/octet-stream'
		});
		const long = await store(contextA, { name: 'x'.repeat(250) });
		expect((await getDocument(db, 'a', long))!.name).toBe('x'.repeat(200));
	});

	it('rejects empty and too large files without storing anything', async () => {
		expect(
			await storeDocument(db, contextA, { ...pdf, bytes: new Uint8Array(0) }, { storage })
		).toEqual({ ok: false, reason: 'empty' });
		expect(
			await storeDocument(
				db,
				contextA,
				{ ...pdf, bytes: new Uint8Array(MAX_DOCUMENT_BYTES + 1) },
				{ storage }
			)
		).toEqual({ ok: false, reason: 'too-large' });
		expect(await storedFiles()).toEqual([]);
		expect(await db.select().from(documents)).toEqual([]);
		expect(await db.select().from(auditLog)).toEqual([]);
	});

	it('refuses a link to another account and writes no object', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'b');
		const tenantId = await seedTenant(db, 'b');
		const lease = await createLease(db, contextB, leaseInput(unitId));
		if (!lease.ok) throw new Error('setup failed');
		const costItemId = await seedCostItem(db, 'b', propertyId);

		for (const links of [
			{ propertyId },
			{ unitId },
			{ leaseId: lease.id },
			{ tenantId },
			{ costItemId }
		]) {
			expect(await storeDocument(db, contextA, { ...pdf, links }, { storage })).toEqual({
				ok: false,
				reason: 'unknown-link'
			});
		}
		expect(await storedFiles()).toEqual([]);
		expect(await db.select().from(documents)).toEqual([]);
	});

	it('removes the object again when the row cannot be written', async () => {
		// The uploader must exist; an unknown user id makes the insert fail.
		const ghost = { accountId: 'a', userId: 'ghost' };
		await expect(storeDocument(db, ghost, pdf, { storage })).rejects.toThrow();
		expect(await storedFiles()).toEqual([]);
		expect(await db.select().from(documents)).toEqual([]);
	});
});

describe('getDocument and openDocument', () => {
	it('opens the document with its bytes for the download', async () => {
		const id = await store(contextA, {});
		const opened = await openDocument(db, 'a', id, { storage });
		expect(opened).toBeDefined();
		expect(opened!.document.id).toBe(id);
		expect(opened!.contentType).toBe('application/pdf');
		expect(opened!.size).toBe(pdf.bytes.byteLength);
		expect(await readBody(opened!.body)).toBe('%PDF-1.4 test');
	});

	it('does not open a document whose object is gone', async () => {
		const id = await store(contextA, {});
		await rm(join(root, 'a', id));
		expect(await openDocument(db, 'a', id, { storage })).toBeUndefined();
		// The row itself is still there, so the user can delete it.
		expect(await getDocument(db, 'a', id)).toBeDefined();
	});

	it('does not return a document of another account', async () => {
		const id = await store(contextB, {});
		expect(await getDocument(db, 'a', id)).toBeUndefined();
		expect(await openDocument(db, 'a', id, { storage })).toBeUndefined();
		expect(await getDocument(db, 'b', id)).toBeDefined();
	});
});

describe('listDocuments', () => {
	it('lists the documents of the account newest first, and by each link kind', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'a');
		const tenantId = await seedTenant(db, 'a');
		const lease = await createLease(db, contextA, leaseInput(unitId, { tenantIds: [tenantId] }));
		if (!lease.ok) throw new Error('setup failed');
		const costItemId = await seedCostItem(db, 'a', propertyId);

		const older = await store(contextA, { name: 'Alt.pdf', links: { propertyId, unitId } });
		const newer = await store(contextA, {
			name: 'Neu.pdf',
			links: { leaseId: lease.id, tenantId, costItemId }
		});
		const loose = await store(contextA, { name: 'Lose.pdf' });
		await db
			.update(documents)
			.set({ createdAt: new Date('2025-01-01T00:00:00Z') })
			.where(eq(documents.id, older));
		await db
			.update(documents)
			.set({ createdAt: new Date('2025-03-01T00:00:00Z') })
			.where(eq(documents.id, newer));
		await db
			.update(documents)
			.set({ createdAt: new Date('2025-02-01T00:00:00Z') })
			.where(eq(documents.id, loose));

		const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
		expect(ids(await listDocuments(db, 'a'))).toEqual([newer, loose, older]);
		expect(ids(await listDocuments(db, 'a', { propertyId }))).toEqual([older]);
		expect(ids(await listDocuments(db, 'a', { unitId }))).toEqual([older]);
		expect(ids(await listDocuments(db, 'a', { leaseId: lease.id }))).toEqual([newer]);
		expect(ids(await listDocuments(db, 'a', { tenantId }))).toEqual([newer]);
		expect(ids(await listDocuments(db, 'a', { costItemId }))).toEqual([newer]);
		expect(ids(await listDocuments(db, 'a', { propertyId, leaseId: lease.id }))).toEqual([]);
	});

	it('does not list documents of another account', async () => {
		const { propertyId } = await seedUnit(db, 'b');
		await store(contextB, { links: { propertyId } });
		await store(contextA, {});
		expect(await listDocuments(db, 'a')).toHaveLength(1);
		expect(await listDocuments(db, 'a', { propertyId })).toEqual([]);
		expect(await listDocuments(db, 'b')).toHaveLength(1);
	});
});

describe('deleteDocument', () => {
	it('removes the object and the row, and logs it', async () => {
		const id = await store(contextA, { name: 'Beleg.pdf' });
		expect(await deleteDocument(db, contextA, id, { storage })).toBe(true);
		expect(await getDocument(db, 'a', id)).toBeUndefined();
		expect(await storedFiles()).toEqual([]);

		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'delete'));
		expect(audit.map((entry) => [entry.entity, entry.entityId, entry.summary])).toEqual([
			['document', id, 'Dokument Beleg.pdf gelöscht']
		]);
	});

	it('does not delete a document of another account', async () => {
		const id = await store(contextB, {});
		expect(await deleteDocument(db, contextA, id, { storage })).toBe(false);
		expect(await getDocument(db, 'b', id)).toBeDefined();
		expect(await exists(join(root, 'b', id))).toBe(true);
		expect(await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'))).toEqual([]);
	});
});

describe('deleteAllDocuments', () => {
	it('removes the objects and rows of one account only and tolerates a missing object', async () => {
		const first = await store(contextA, { name: 'Eins.pdf' });
		const second = await store(contextA, { name: 'Zwei.pdf' });
		const foreign = await store(contextB, { name: 'Fremd.pdf' });
		await rm(join(root, 'a', second));

		expect(await deleteAllDocuments(db, 'a', { storage })).toBe(2);
		expect(await listDocuments(db, 'a')).toEqual([]);
		expect(await exists(join(root, 'a', first))).toBe(false);
		expect(await exists(join(root, 'a', `${second}.type`))).toBe(false);
		expect((await listDocuments(db, 'b')).map((row) => row.id)).toEqual([foreign]);
		expect(await storedFiles()).toEqual([`b/${foreign}`, `b/${foreign}.type`]);

		expect(await deleteAllDocuments(db, 'a', { storage })).toBe(0);
	});

	it('deletes the objects in bulk calls of at most 1000 keys, not one call per document', async () => {
		// 2.001 documents of account a and one of b, inserted as rows; their objects do not exist,
		// which the adapters treat as already deleted.
		const rows = Array.from({ length: 2001 }, (_, index) => ({
			id: `doc-${index}`,
			accountId: 'a',
			name: `Beleg ${index}.pdf`,
			mimeType: 'application/pdf',
			size: 1,
			storageKey: `a/doc-${index}`
		}));
		rows.push({ ...rows[0], id: 'doc-b', accountId: 'b', storageKey: 'b/doc-b' });
		for (const group of chunk(rows, rowsPerStatement(documents))) {
			await db.insert(documents).values(group);
		}
		const calls: string[][] = [];
		const counting: Storage = {
			...storage,
			async delete() {
				throw new Error('one call per document');
			},
			async deleteMany(keys) {
				calls.push(keys);
			}
		};

		expect(await deleteAllDocuments(db, 'a', { storage: counting })).toBe(2001);
		// 2.001 keys = 1.000 + 1.000 + 1, all of account a.
		expect(calls.map((keys) => keys.length)).toEqual([1000, 1000, 1]);
		expect(new Set(calls.flat()).size).toBe(2001);
		expect(calls.flat().every((key) => key.startsWith('a/doc-'))).toBe(true);
		expect(await listDocuments(db, 'a')).toEqual([]);
		expect((await listDocuments(db, 'b')).map((row) => row.id)).toEqual(['doc-b']);
	});
});
