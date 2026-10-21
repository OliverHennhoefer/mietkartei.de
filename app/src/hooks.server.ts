import { error, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { E2E } from '$app/env/private';
import { SESSION_COOKIE, validateSession } from '#lib/server/auth.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import { getDatabase } from '#lib/server/db/index.ts';
import { getAuthLimiter } from '#lib/server/rate-limit/index.ts';

/** Paths that work without signing in. Everything else redirects to the sign-in page. */
const publicPaths = new Set(['/anmelden', '/registrieren', '/health']);

/** Paths whose posts check a password or create an account, counted per client address. */
const authPaths = new Set(['/anmelden', '/registrieren']);

function isPublic(pathname: string): boolean {
	if (publicPaths.has(pathname)) return true;
	// Test-only endpoints, e.g. the seed. Only enabled by the end-to-end test server.
	return E2E && pathname.startsWith('/api/e2e/');
}

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

	if (!event.locals.user && !isPublic(event.url.pathname)) redirect(303, '/anmelden');
	// Counted with or without a session: a signed-in client can post to these actions as well.
	if (event.request.method === 'POST' && authPaths.has(event.url.pathname)) {
		const limiter = await getAuthLimiter();
		if (!(await limiter.limit(`auth:${event.getClientAddress()}`))) {
			error(429, 'Zu viele Versuche in kurzer Zeit. Bitte warte eine Minute.');
		}
	}
	return resolve(event);
};
