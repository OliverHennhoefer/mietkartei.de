import { error, json } from '@sveltejs/kit';
import { blocksOf } from '#lib/server/pdf.ts';
import { reminderLetter, updateReminderText } from '#lib/server/reminders.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

// A Zahlungserinnerung or Mahnung for its sheet in the preview dialog: GET the letter as laid
// out, PUT `{ paragraphs }` to replace its text.

const missing = 'Dieses Schreiben gibt es nicht.';

export const GET: RequestHandler = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const result = await reminderLetter(locals.db, accountId, params.id, params.reminderId);
	if (!result) error(404, missing);
	return json({ ...result.letter, blocks: blocksOf(result.letter) });
};

export const PUT: RequestHandler = async ({ locals, params, request, url }) => {
	requireAccount(locals);
	if (request.headers.get('origin') !== url.origin) error(403, 'Anfrage von einer fremden Seite');
	const body = await request.json().catch(() => null);
	const result = await updateReminderText(
		locals.db,
		auditContext(locals),
		params.id,
		params.reminderId,
		body?.paragraphs
	);
	if (!result) error(404, missing);
	if (!result.ok) error(400, result.message);
	return new Response(null, { status: 204 });
};
