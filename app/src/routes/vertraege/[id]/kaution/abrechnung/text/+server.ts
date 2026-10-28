import { error, json } from '@sveltejs/kit';
import { settlementLetter, updateSettlementText } from '#lib/server/deposit-settlements.ts';
import { blocksOf } from '#lib/server/pdf.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

// The Kautionsabrechnung for its sheet in the preview dialog: GET the letter as laid out, PUT
// `{ paragraphs }` to replace its text.

const missing = 'Zu diesem Mietvertrag gibt es keine Kautionsabrechnung.';

export const GET: RequestHandler = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const result = await settlementLetter(locals.db, accountId, params.id);
	if (!result) error(404, missing);
	return json({ ...result.letter, blocks: blocksOf(result.letter) });
};

export const PUT: RequestHandler = async ({ locals, params, request, url }) => {
	requireAccount(locals);
	if (request.headers.get('origin') !== url.origin) error(403, 'Anfrage von einer fremden Seite');
	const body = await request.json().catch(() => null);
	const result = await updateSettlementText(
		locals.db,
		auditContext(locals),
		params.id,
		body?.paragraphs
	);
	if (!result) error(404, missing);
	if (!result.ok) error(400, result.message);
	return new Response(null, { status: 204 });
};
