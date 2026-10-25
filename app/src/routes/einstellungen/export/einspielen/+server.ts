import { error, json } from '@sveltejs/kit';
import { gunzipText, restoreExport } from '#lib/server/restore.ts';
import { auditContext, requireOwner } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** export.json unpacked may be this large; more is not an export of a landlord's account. */
const MAX_EXPORT_JSON_BYTES = 256 * 1024 * 1024;

const messages = {
	invalid: 'Die Datei ist kein Export von mietkartei oder stammt aus einer anderen Version.',
	'not-empty':
		'Dein Konto enthält schon Objekte oder Dokumente. Ein Export lässt sich nur in ein leeres Konto einspielen.',
	quota:
		'Der Export enthält mehr Dokumente, als ein Konto haben darf (höchstens 2.000 Dokumente mit zusammen 1 GB).',
	rejected:
		'Der Export ließ sich nicht einspielen. Liegt das exportierte Konto noch auf dieser Instanz, lösche es dort zuerst oder nutze eine andere Instanz.'
};

/**
 * Restores export.json, sent gzipped by the export page, which reads the ZIP in the browser and
 * sends the documents one by one afterwards ([id]). Owners only, into an empty account.
 */
export const POST: RequestHandler = async ({ locals, request, url }) => {
	requireOwner(locals);
	// Only the export page sends this; a page of another site cannot post a gzip body here.
	if (request.headers.get('origin') !== url.origin) error(403, 'Anfrage von einer fremden Seite');
	if (!request.body) error(400, messages.invalid);
	let data: unknown;
	try {
		data = JSON.parse(await gunzipText(request.body, MAX_EXPORT_JSON_BYTES));
	} catch {
		error(400, messages.invalid);
	}
	const result = await restoreExport(locals.db, auditContext(locals), data);
	if (!result.ok) error(result.reason === 'not-empty' ? 409 : 400, messages[result.reason]);
	return json({ rows: result.rows, documents: result.documents });
};
