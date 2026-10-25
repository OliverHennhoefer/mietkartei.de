import { error } from '@sveltejs/kit';
import { pdfResponse, renderLetter } from '#lib/server/pdf.ts';
import { reminderLetter } from '#lib/server/reminders.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** A Zahlungserinnerung or Mahnung as PDF. Layouts do not run for endpoints, so the lookup is here. */
export const GET: RequestHandler = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const result = await reminderLetter(locals.db, accountId, params.id, params.reminderId);
	if (!result) error(404, 'Dieses Schreiben gibt es nicht.');
	return pdfResponse(await renderLetter(result.letter), result.filename);
};
