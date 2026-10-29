import { error } from '@sveltejs/kit';
import { settlementLetter } from '#lib/server/deposit-settlements.ts';
import { pdfResponse, renderLetter } from '#lib/server/pdf.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** The Kautionsabrechnung as PDF. Layouts do not run for endpoints, so the lookup is here. */
export const GET: RequestHandler = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const result = await settlementLetter(locals.db, accountId, params.id);
	if (!result) error(404, 'Zu diesem Mietvertrag gibt es keine Kautionsabrechnung.');
	return pdfResponse(await renderLetter(result.letter), result.filename);
};
