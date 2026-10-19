import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, validateSession } from '#lib/server/auth.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import { getDatabase } from '#lib/server/db/index.ts';

/** Paths that work without signing in. Everything else redirects to the sign-in page. */
const publicPaths = new Set(['/anmelden', '/registrieren', '/health']);

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.db = await getDatabase();
	event.locals.user = undefined;

	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const session = await validateSession(event.locals.db, token);
		if (session) {
			event.locals.user = session.user;
			if (session.expiresAt) setSessionCookie(event, token, session.expiresAt);
		} else {
			event.cookies.delete(SESSION_COOKIE, { path: '/' });
		}
	}

	if (!event.locals.user && !publicPaths.has(event.url.pathname)) redirect(303, '/anmelden');
	return resolve(event);
};
