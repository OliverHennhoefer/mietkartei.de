import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { E2E } from '$app/env/private';
import { validateSession } from '#lib/server/auth.ts';
import { applySecurityHeaders } from '#lib/server/security-headers.ts';
import { deleteSessionCookie, getSessionToken, setSessionCookie } from '#lib/server/session.ts';
import { getDatabase } from '#lib/server/db/index.ts';

/** Paths that work without signing in. Everything else redirects to the sign-in page. */
const publicPaths = new Set(['/anmelden', '/registrieren', '/health']);

function isPublic(pathname: string): boolean {
	if (publicPaths.has(pathname)) return true;
	// Test-only endpoints, e.g. the seed. Only enabled by the end-to-end test server.
	return E2E && pathname.startsWith('/api/e2e/');
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.db = await getDatabase();
	event.locals.user = undefined;

	const token = getSessionToken(event);
	if (token) {
		const session = await validateSession(event.locals.db, token);
		if (session) {
			event.locals.user = session.user;
			if (session.expiresAt) setSessionCookie(event, token, session.expiresAt);
		} else {
			deleteSessionCookie(event);
		}
	}

	if (!event.locals.user && !isPublic(event.url.pathname)) redirect(303, '/anmelden');
	const response = await resolve(event);
	applySecurityHeaders(response.headers, {
		https: event.url.protocol === 'https:',
		signedIn: Boolean(event.locals.user)
	});
	return response;
};
