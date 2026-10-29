import { error } from '@sveltejs/kit';
import { handoverReport } from '#lib/server/handovers.ts';
import { pdfResponse, renderReport } from '#lib/server/pdf.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** An Übergabeprotokoll as PDF to print and sign: /uebergabe/einzug or /uebergabe/auszug. */
export const GET: RequestHandler = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const kind = params.art === 'einzug' ? 'move_in' : params.art === 'auszug' ? 'move_out' : null;
	const result = kind && (await handoverReport(locals.db, accountId, params.id, kind));
	if (!result) error(404, 'Dieses Protokoll gibt es nicht.');
	return pdfResponse(await renderReport(result.report), result.filename);
};
