import { error, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { E2E } from '$app/env/private';
import { validateSession } from '#lib/server/auth.ts';
import { applySecurityHeaders } from '#lib/server/security-headers.ts';
import { deleteSessionCookie, getSessionToken, setSessionCookie } from '#lib/server/session.ts';
import { getDatabase } from '#lib/server/db/index.ts';
import { getAuthLimiter } from '#lib/server/rate-limit/index.ts';

/** Paths that work without signing in. Everything else redirects to the sign-in page. */
const publicPaths = new Set(['/anmelden', '/registrieren', '/passwort-vergessen', '/health']);
const publicPrefixes = ['/passwort-zuruecksetzen/', '/einladung/'];

/**
 * Paths whose posts check a password, create an account or send a reset mail, counted per client
 * address. A reset request also writes a row for the address, so unthrottled it could fill the
 * database.
 */
const authPaths = new Set(['/anmelden', '/registrieren', '/passwort-vergessen']);

function isPublic(pathname: string): boolean {
	if (publicPaths.has(pathname)) return true;
	if (publicPrefixes.some((prefix) => pathname.startsWith(prefix))) return true;
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
	// Counted with or without a session: a signed-in client can post to these actions as well.
	if (event.request.method === 'POST' && authPaths.has(event.url.pathname)) {
		const limiter = await getAuthLimiter();
		if (!(await limiter.limit(`auth:${event.getClientAddress()}`))) {
			error(429, 'Zu viele Versuche in kurzer Zeit. Bitte warte eine Minute.');
		}
	}
	const response = await resolve(event);
	applySecurityHeaders(response.headers, {
		https: event.url.protocol === 'https:',
		signedIn: Boolean(event.locals.user)
	});
	return response;
};
