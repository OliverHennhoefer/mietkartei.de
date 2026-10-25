import { error, json } from '@sveltejs/kit';
import { restoreExport } from '#lib/server/restore.ts';
import { auditContext, requireOwner } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** export.json unpacked may be this large; more is not an export of a landlord's account. */
const MAX_EXPORT_JSON_BYTES = 256 * 1024 * 1024;

const messages = {
	invalid: 'Die Datei ist kein Export von mietkartei oder stammt aus einer anderen Version.',
	'not-empty':
		'Dein Konto enthält schon Objekte oder Dokumente. Ein Export lässt sich nur in ein leeres Konto einspielen.',
	rejected:
		'Der Export ließ sich nicht einspielen. Liegt das exportierte Konto noch auf dieser Instanz, lösche es dort zuerst oder nutze eine andere Instanz.'
};

/** The text of a gzip body, refused once it unpacks to more than `limit` bytes. */
async function gunzipText(
	body: ReadableStream<Uint8Array<ArrayBuffer>>,
	limit: number
): Promise<string> {
	const reader = body.pipeThrough(new DecompressionStream('gzip')).getReader();
	const decoder = new TextDecoder();
	let text = '';
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return text + decoder.decode();
		size += value.byteLength;
		if (size > limit) {
			await reader.cancel();
			throw new Error('too large');
		}
		text += decoder.decode(value, { stream: true });
	}
}

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
