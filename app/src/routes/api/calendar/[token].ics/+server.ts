import { error } from '@sveltejs/kit';
import { accountOfToken, buildCalendar, calendarEntries } from '#lib/server/calendar.ts';
import type { RequestHandler } from './$types';

// The calendar subscription: no session, the secret token in the path is the credential. An
// unknown or revoked token answers 404, like a page that does not exist.
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const accountId = await accountOfToken(locals.db, params.token);
	if (!accountId) error(404, 'Diesen Kalender gibt es nicht.');
	const body = buildCalendar(await calendarEntries(locals.db, accountId, url.origin));
	return new Response(body, {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'content-disposition': 'inline; filename="mietkartei-fristen.ics"',
			'cache-control': 'private, no-store'
		}
	});
};
