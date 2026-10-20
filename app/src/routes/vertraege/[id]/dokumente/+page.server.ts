import { error } from '@sveltejs/kit';
import { listDocuments } from '#lib/server/documents.ts';
import { getLease } from '#lib/server/leases.ts';
import { requireAccount } from '#lib/server/session.ts';
import {
	documentRow,
	loadDocumentLinkOptions,
	removeDocument,
	uploadDocument
} from '../../../dokumente/helpers.server';
import type { Actions, PageServerLoad } from './$types';

// The Dokumente tab of a lease: its documents, and an upload that links the lease itself.
export const load: PageServerLoad = async ({ locals, parent }) => {
	const accountId = requireAccount(locals);
	const { lease } = await parent();
	const [rows, options] = await Promise.all([
		listDocuments(locals.db, accountId, { leaseId: lease.id }),
		loadDocumentLinkOptions(locals.db, accountId)
	]);
	return { documents: rows.map(documentRow), options };
};

export const actions: Actions = {
	upload: async ({ locals, request, params }) => {
		// Actions run without the layout load, so the lease is checked here before it is linked.
		const lease = await getLease(locals.db, requireAccount(locals), params.id);
		if (!lease) error(404, 'Diesen Mietvertrag gibt es nicht.');
		return uploadDocument(locals, request, { leaseId: lease.id, propertyId: lease.property.id });
	},
	delete: ({ locals, request }) => removeDocument(locals, request)
};
