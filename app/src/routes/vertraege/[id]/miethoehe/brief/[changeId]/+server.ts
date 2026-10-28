import { error } from '@sveltejs/kit';
import { pdfResponse, renderLetter } from '#lib/server/pdf.ts';
import { rentLetter } from '#lib/server/rent-adjustments.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** The letter of an index change or a § 558 demand as PDF. Layouts do not run for endpoints, so the lookup is here. */
export const GET: RequestHandler = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const result = await rentLetter(locals.db, accountId, params.id, params.changeId);
	if (!result) error(404, 'Zu dieser Mietänderung gibt es kein Schreiben.');
	return pdfResponse(await renderLetter(result.letter), result.filename);
};
