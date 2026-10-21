import { today } from '#lib/dates.ts';
import { exportZip } from '#lib/server/export.ts';
import { auditContext, requireOwner } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/**
 * The ZIP with export.json and the documents, streamed while it is built, so its size is not
 * known up front (no Content-Length). Owners only; logged once complete.
 */
export const GET: RequestHandler = async ({ locals }) => {
	requireOwner(locals);
	const body = await exportZip(locals.db, auditContext(locals));
	return new Response(body, {
		headers: {
			'content-type': 'application/zip',
			// Workers would otherwise compress the stream on the fly; the archive is compressed.
			'content-encoding': 'identity',
			'content-disposition': `attachment; filename="mietkartei-export-${today()}.zip"`,
			'cache-control': 'private, no-store'
		}
	});
};
