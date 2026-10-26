import { error } from '@sveltejs/kit';
import { canInline, contentDisposition } from '#lib/domain/documents.ts';
import { openDocument } from '#lib/server/documents.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

// Streams a document of the signed-in account through the storage adapter (no node:fs here,
// the route runs on Workers too). Saved under its name by default; `?inline=1` lets the
// browser show a PDF or image instead. Only types whose bytes were checked on upload are shown
// inline (storedMimeType). Everything else runs in a CSP sandbox; an inline PDF does not,
// because Chrome refuses to open a PDF in a sandboxed document.
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const accountId = requireAccount(locals);
	const opened = await openDocument(locals.db, accountId, params.id);
	if (!opened) error(404, 'Dieses Dokument gibt es nicht.');
	const inline = url.searchParams.get('inline') === '1' && canInline(opened.contentType);
	return new Response(opened.body, {
		headers: {
			'Content-Type': opened.contentType,
			'Content-Length': String(opened.size),
			'Content-Disposition': contentDisposition(opened.document.name, inline),
			'Cache-Control': 'private, no-store',
			// Workers would gzip a text file on the fly, chunked and without Content-Length; the
			// explicit identity encoding keeps a download byte for byte as it was uploaded.
			'Content-Encoding': 'identity',
			'X-Content-Type-Options': 'nosniff',
			// An inline PDF also shows in a frame of the app's preview dialog (PreviewLink).
			...(inline && opened.contentType.startsWith('application/pdf')
				? { 'X-Frame-Options': 'SAMEORIGIN' }
				: { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'" })
		}
	});
};
