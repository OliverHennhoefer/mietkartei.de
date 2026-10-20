import { today } from '#lib/dates.ts';
import { buildExportZip } from '#lib/server/export.ts';
import { auditContext, requireOwner } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** The ZIP with export.json and the documents, built in memory. Owners only; logged. */
export const GET: RequestHandler = async ({ locals }) => {
	requireOwner(locals);
	const zip = await buildExportZip(locals.db, auditContext(locals));
	return new Response(
		zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer,
		{
			headers: {
				'content-type': 'application/zip',
				'content-length': String(zip.byteLength),
				'content-disposition': `attachment; filename="mietkartei-export-${today()}.zip"`,
				'cache-control': 'no-store'
			}
		}
	);
};
