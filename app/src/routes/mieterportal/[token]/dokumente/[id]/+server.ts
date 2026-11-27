import { error } from '@sveltejs/kit';
import { canInline, contentDisposition } from '#lib/domain/documents.ts';
import { openPortal, openPortalDocument } from '#lib/server/tenant-portal.ts';
import type { RequestHandler } from './$types';

// A document the landlord shared in the Mieterportal, for whoever has the link. Served like the
// download of /dokumente: inline only for checked PDFs and images, everything else sandboxed.
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const access = await openPortal(locals.db, params.token);
	if (!access) error(404, 'Dieser Link gilt nicht mehr.');
	const opened = await openPortalDocument(locals.db, access, params.id);
	if (!opened) error(404, 'Dieses Dokument gibt es nicht.');
	const inline = url.searchParams.get('inline') === '1' && canInline(opened.contentType);
	return new Response(opened.body, {
		headers: {
			'Content-Type': opened.contentType,
			'Content-Length': String(opened.size),
			'Content-Disposition': contentDisposition(opened.document.name, inline),
			'Cache-Control': 'private, no-store',
			'Content-Encoding': 'identity',
			'X-Content-Type-Options': 'nosniff',
			...(inline && opened.contentType.startsWith('application/pdf')
				? {}
				: { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'" })
		}
	});
};
