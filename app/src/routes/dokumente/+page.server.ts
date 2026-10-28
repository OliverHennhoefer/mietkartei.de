import { parseDocumentFilter } from '#lib/forms/documents.ts';
import { listDocuments } from '#lib/server/documents.ts';
import { requireAccount } from '#lib/server/session.ts';
import {
	documentRow,
	loadDocumentLinkOptions,
	removeDocument,
	uploadDocument
} from './helpers.server';
import type { Actions, PageServerLoad } from './$types';

// All documents of the account, narrowed by the link query parameters, with the upload form.
export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const filter = parseDocumentFilter(url.searchParams);
	const [rows, options] = await Promise.all([
		listDocuments(locals.db, accountId, filter),
		loadDocumentLinkOptions(locals.db, accountId)
	]);
	return {
		documents: rows.map(documentRow),
		options,
		filter,
		filtered: Object.keys(filter).length > 0
	};
};

export const actions: Actions = {
	upload: ({ locals, request }) => uploadDocument(locals, request),
	delete: ({ locals, request }) => removeDocument(locals, request, '/dokumente')
};
