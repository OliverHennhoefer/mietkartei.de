import { and, asc, desc, eq } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { documents, leases, properties, tenants, units } from './db/schema';
import { getStorage, storageKey, type Storage } from './storage';

// Documents (Dokumente): uploaded files such as the signed lease, a protocol or a letter. The
// bytes live in the storage adapter under `<accountId>/<documentId>`, the row in `documents`
// says what they are and what they belong to. A document is only ever served to a signed-in
// user of the account that uploaded it.

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type Document = typeof documents.$inferSelect;

/** What a document belongs to; every link is optional and checked against the account. */
export type DocumentLinks = {
	propertyId?: string | null;
	unitId?: string | null;
	leaseId?: string | null;
	tenantId?: string | null;
};

export type DocumentFilter = {
	propertyId?: string;
	unitId?: string;
	leaseId?: string;
	tenantId?: string;
};

export type DocumentError = 'too-large' | 'empty' | 'unknown-link';

/** The storage adapter of the deployment, unless a test passes its own. */
type StorageOptions = { storage?: Storage };

async function resolveStorage(options: StorageOptions | undefined): Promise<Storage> {
	return options?.storage ?? (await getStorage());
}

type LinkedTable = SQLiteTable & { id: SQLiteColumn; accountId: SQLiteColumn };

const linkTables: [keyof DocumentLinks, LinkedTable][] = [
	['propertyId', properties],
	['unitId', units],
	['leaseId', leases],
	['tenantId', tenants]
];

/** Whether every given link points at a row of the account; one query per given link kind. */
async function linksBelongToAccount(
	db: Database,
	accountId: string,
	links: DocumentLinks
): Promise<boolean> {
	for (const [key, table] of linkTables) {
		const id = links[key];
		if (!id) continue;
		const [row] = await db
			.select({ id: table.id })
			.from(table)
			.where(and(eq(table.accountId, accountId), eq(table.id, id)));
		if (!row) return false;
	}
	return true;
}

/**
 * Stores the bytes and the row, atomically as far as two systems allow: the object is written
 * first, so a row never points at nothing; if the row cannot be written, the object is removed
 * again, so nothing is left behind that no row reaches.
 */
export async function storeDocument(
	db: Database,
	context: AuditContext,
	input: { name: string; mimeType: string; bytes: Uint8Array; links?: DocumentLinks },
	options?: StorageOptions
): Promise<{ ok: true; id: string } | { ok: false; reason: DocumentError }> {
	const { accountId } = context;
	const size = input.bytes.byteLength;
	if (size === 0) return { ok: false, reason: 'empty' };
	if (size > MAX_DOCUMENT_BYTES) return { ok: false, reason: 'too-large' };
	const links = input.links ?? {};
	if (!(await linksBelongToAccount(db, accountId, links))) {
		return { ok: false, reason: 'unknown-link' };
	}

	const name = input.name.trim().slice(0, 200).trim() || 'Dokument';
	const mimeType = input.mimeType.trim() || 'application/octet-stream';
	const id = crypto.randomUUID();
	const key = storageKey(accountId, id);
	const storage = await resolveStorage(options);

	await storage.put(key, input.bytes, mimeType);
	try {
		await runBatch(db, [
			db.insert(documents).values({
				id,
				accountId,
				name,
				mimeType,
				size,
				storageKey: key,
				propertyId: links.propertyId ?? null,
				unitId: links.unitId ?? null,
				leaseId: links.leaseId ?? null,
				tenantId: links.tenantId ?? null,
				uploadedBy: context.userId
			}),
			auditEntry(db, context, 'document', id, 'upload', `Dokument ${name} hochgeladen`)
		]);
	} catch (error) {
		// The original error is what the caller needs to see, even if the cleanup fails too.
		await storage.delete(key).catch(() => undefined);
		throw error;
	}
	return { ok: true, id };
}

export async function getDocument(
	db: Database,
	accountId: string,
	documentId: string
): Promise<Document | undefined> {
	const [document] = await db
		.select()
		.from(documents)
		.where(and(eq(documents.accountId, accountId), eq(documents.id, documentId)));
	return document;
}

/**
 * The document with its bytes, for the download route, which builds the Response itself.
 * Undefined when the document is not in the account or its object is gone.
 */
export async function openDocument(
	db: Database,
	accountId: string,
	documentId: string,
	options?: StorageOptions
): Promise<
	{ document: Document; body: ReadableStream; contentType: string; size: number } | undefined
> {
	const document = await getDocument(db, accountId, documentId);
	if (!document) return undefined;
	const storage = await resolveStorage(options);
	const object = await storage.get(document.storageKey);
	if (!object) return undefined;
	// The row's type is what was uploaded; the adapter may have lost its copy (fs sidecar file).
	return { document, body: object.body, contentType: document.mimeType, size: object.size };
}

/** The documents of the account, newest first, narrowed to what the given links point at. */
export async function listDocuments(
	db: Database,
	accountId: string,
	filter: DocumentFilter = {}
): Promise<Document[]> {
	const conditions = [eq(documents.accountId, accountId)];
	if (filter.propertyId) conditions.push(eq(documents.propertyId, filter.propertyId));
	if (filter.unitId) conditions.push(eq(documents.unitId, filter.unitId));
	if (filter.leaseId) conditions.push(eq(documents.leaseId, filter.leaseId));
	if (filter.tenantId) conditions.push(eq(documents.tenantId, filter.tenantId));
	return db
		.select()
		.from(documents)
		.where(and(...conditions))
		.orderBy(desc(documents.createdAt), asc(documents.name));
}

/**
 * Deletes the object first, then the row: a row without an object is noticed on download, an
 * object without a row would never be found again. Returns false when the document is not in
 * the account.
 */
export async function deleteDocument(
	db: Database,
	context: AuditContext,
	documentId: string,
	options?: StorageOptions
): Promise<boolean> {
	const document = await getDocument(db, context.accountId, documentId);
	if (!document) return false;
	const storage = await resolveStorage(options);
	await storage.delete(document.storageKey);
	await runBatch(db, [
		db
			.delete(documents)
			.where(and(eq(documents.accountId, context.accountId), eq(documents.id, documentId))),
		auditEntry(db, context, 'document', documentId, 'delete', `Dokument ${document.name} gelöscht`)
	]);
	return true;
}
