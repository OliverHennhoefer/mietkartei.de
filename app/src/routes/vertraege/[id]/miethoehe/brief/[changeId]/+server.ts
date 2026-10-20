import { error } from '@sveltejs/kit';
import { pdfResponse, renderLetter } from '#lib/server/pdf.ts';
import { indexLetter } from '#lib/server/rent-adjustments.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** The index rent letter of an approved change as PDF. Layouts do not run for endpoints, so the lookup is here. */
export const GET: RequestHandler = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const result = await indexLetter(locals.db, accountId, params.id, params.changeId);
	if (!result) error(404, 'Zu dieser Mietänderung gibt es kein Schreiben.');
	return pdfResponse(await renderLetter(result.letter), result.filename);
};
