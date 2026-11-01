import { error } from '@sveltejs/kit';
import { asciiFilename } from '#lib/server/pdf.ts';
import { receiptPackage } from '#lib/server/statement-receipts.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

// The Belegpaket: the overview and the documents of the allocable cost items as one ZIP.
export const GET: RequestHandler = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const receipts = await receiptPackage(locals.db, accountId, params.id);
	if (!receipts) error(404, 'Diese Abrechnung gibt es nicht.');
	const fallback = asciiFilename(receipts.filename);
	return new Response(receipts.bytes as Uint8Array<ArrayBuffer>, {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(receipts.filename)}`,
			'cache-control': 'private, no-store'
		}
	});
};
