import { error } from '@sveltejs/kit';
import { MAX_DOCUMENT_BYTES } from '#lib/server/documents.ts';
import { restoreDocument } from '#lib/server/restore.ts';
import { requireOwner } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

const messages = {
	unknown: 'Dieses Dokument gehört zu keinem eingespielten Export.',
	size: 'Die Datei hat nicht die Größe, die der Export für dieses Dokument nennt.',
	exists: 'Dieses Dokument ist schon eingespielt.'
};

/** The file of one document of a restored export, as the raw request body. Owners only. */
export const PUT: RequestHandler = async ({ locals, params, request, url }) => {
	const user = requireOwner(locals);
	if (request.headers.get('origin') !== url.origin) error(403, 'Anfrage von einer fremden Seite');
	const length = Number(request.headers.get('content-length') ?? 0);
	if (length > MAX_DOCUMENT_BYTES) error(413, messages.size);
	const bytes = new Uint8Array(await request.arrayBuffer());
	const result = await restoreDocument(locals.db, user.accountId, params.id, bytes);
	if (!result.ok) error(result.reason === 'exists' ? 409 : 400, messages[result.reason]);
	return new Response(null, { status: 204 });
};
