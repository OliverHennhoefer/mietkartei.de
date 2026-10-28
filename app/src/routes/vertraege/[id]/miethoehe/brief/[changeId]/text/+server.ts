import { error, json } from '@sveltejs/kit';
import { blocksOf } from '#lib/server/pdf.ts';
import { rentLetter, updateRentLetterText } from '#lib/server/rent-adjustments.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

// The letter of an index change or a § 558 demand for its sheet in the preview dialog: GET the
// letter as laid out, PUT `{ paragraphs }` to replace its text.

const missing = 'Zu dieser Mietänderung gibt es kein Schreiben.';

export const GET: RequestHandler = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const result = await rentLetter(locals.db, accountId, params.id, params.changeId);
	if (!result) error(404, missing);
	return json({ ...result.letter, blocks: blocksOf(result.letter) });
};

export const PUT: RequestHandler = async ({ locals, params, request, url }) => {
	requireAccount(locals);
	if (request.headers.get('origin') !== url.origin) error(403, 'Anfrage von einer fremden Seite');
	const body = await request.json().catch(() => null);
	const result = await updateRentLetterText(
		locals.db,
		auditContext(locals),
		params.id,
		params.changeId,
		body?.paragraphs
	);
	if (!result) error(404, missing);
	if (!result.ok) error(400, result.message);
	return new Response(null, { status: 204 });
};
