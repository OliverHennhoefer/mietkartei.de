import { error, fail, redirect, type ActionFailure } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { DocumentLinkIds, DocumentLinkOptions } from '#lib/domain/documents.ts';
import { personName } from '#lib/format.ts';
import {
	documentErrorMessage,
	parseDocumentId,
	parseDocumentUpload,
	type DocumentUploadInput
} from '#lib/forms/documents.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import type { Database } from '#lib/server/db/index.ts';
import { costItems } from '#lib/server/db/schema.ts';
import {
	deleteDocument,
	storeDocument,
	type Document,
	type DocumentLinks
} from '#lib/server/documents.ts';
import { leaseLabel, listLeases, listUnitsWithProperty } from '#lib/server/leases.ts';
import { listProperties } from '#lib/server/properties.ts';
import { auditContext } from '#lib/server/session.ts';
import { listTenants } from '#lib/server/tenants.ts';

// Shared by /dokumente and the lease's Dokumente tab: the rows a document can be linked to,
// the row a page sends to the browser, and the upload and delete actions.

/** What a page shows of a document; the storage key stays on the server. */
export type DocumentRow = DocumentLinkIds & {
	id: string;
	name: string;
	mimeType: string;
	size: number;
	createdAt: Date;
};

export function documentRow(document: Document): DocumentRow {
	return {
		id: document.id,
		name: document.name,
		mimeType: document.mimeType,
		size: document.size,
		createdAt: document.createdAt,
		propertyId: document.propertyId,
		unitId: document.unitId,
		leaseId: document.leaseId,
		tenantId: document.tenantId,
		costItemId: document.costItemId
	};
}

/**
 * The rows of the account a document can be linked to, as select options and for the link
 * texts of a list: one query per table (the leases take their fixed handful).
 */
export async function loadDocumentLinkOptions(
	db: Database,
	accountId: string
): Promise<DocumentLinkOptions> {
	const [propertyRows, unitRows, leaseRows, tenantRows, costItemRows] = await Promise.all([
		listProperties(db, accountId, { archived: true }),
		listUnitsWithProperty(db, accountId, { archived: true }),
		listLeases(db, accountId),
		listTenants(db, accountId, { archived: true }),
		db
			.select({ id: costItems.id, description: costItems.description })
			.from(costItems)
			.where(eq(costItems.accountId, accountId))
			.orderBy(asc(costItems.description), asc(costItems.createdAt))
	]);
	return {
		properties: propertyRows.map((property) => ({ id: property.id, label: property.name })),
		units: unitRows.map(({ unit, property }) => ({
			id: unit.id,
			label: `${unit.name} · ${property.name}`,
			propertyId: property.id
		})),
		leases: leaseRows.map((lease) => {
			const names = lease.tenants.map(personName).join(', ');
			return { id: lease.id, label: names ? `${leaseLabel(lease)} · ${names}` : leaseLabel(lease) };
		}),
		tenants: tenantRows.map((tenant) => ({ id: tenant.id, label: personName(tenant) })),
		costItems: costItemRows.map((item) => ({ id: item.id, label: item.description }))
	};
}

type UploadFailure = ActionFailure<{
	errors: FieldErrors<DocumentUploadInput>;
	values: Record<string, string>;
}>;

/**
 * The upload action: parses the form, stores the file and answers with the stored name. Links
 * in `fixed` win over the form's (the lease tab fixes the lease and its property); a refusal
 * of the server module becomes a field error.
 */
export async function uploadDocument(
	locals: App.Locals,
	request: Request,
	fixed: DocumentLinks = {}
): Promise<UploadFailure | { uploaded: string }> {
	const context = auditContext(locals);
	const result = parseDocumentUpload(await request.formData());
	if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
	const { file, name, ...chosen } = result.data;
	const stored = await storeDocument(locals.db, context, {
		name,
		mimeType: file.type,
		bytes: new Uint8Array(await file.arrayBuffer()),
		links: { ...chosen, ...fixed }
	});
	if (stored.ok) return { uploaded: name };

	const message = documentErrorMessage(stored.reason);
	const errors: FieldErrors<DocumentUploadInput> = {};
	if (stored.reason === 'unknown-link') {
		for (const key of ['propertyId', 'leaseId', 'tenantId'] as const) {
			if (chosen[key]) errors[key] = message;
		}
	}
	if (Object.keys(errors).length === 0) errors.file = message;
	const values = Object.fromEntries(
		Object.entries({ name, ...chosen }).map(([key, value]) => [key, value ?? ''])
	);
	return fail(400, { errors, values });
}

/** The delete action behind a ConfirmButton with a hidden `documentId`. */
/** Deletes the document named by the form, then goes `back` to the list it was opened from. */
export async function removeDocument(
	locals: App.Locals,
	request: Request,
	back: string
): Promise<never> {
	const context = auditContext(locals);
	const documentId = parseDocumentId(await request.formData());
	if (!documentId) error(400, 'Bitte gib an, welches Dokument gelöscht werden soll.');
	if (!(await deleteDocument(locals.db, context, documentId))) {
		error(404, 'Dieses Dokument gibt es nicht.');
	}
	redirect(303, back);
}
