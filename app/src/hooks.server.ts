import { error, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { DEMO, E2E } from '$app/env/private';
import { validateSession } from '#lib/server/auth.ts';
import { enforceBilling } from '#lib/server/billing.ts';
import { applySecurityHeaders } from '#lib/server/security-headers.ts';
import { deleteSessionCookie, getSessionToken, setSessionCookie } from '#lib/server/session.ts';
import { getDatabase } from '#lib/server/db/index.ts';
import { getAuthLimiter } from '#lib/server/rate-limit/index.ts';

/** Paths that work without signing in. Everything else redirects to the sign-in page. */
const publicPaths = new Set([
	'/anmelden',
	'/registrieren',
	'/passwort-vergessen',
	// Stripe's deliveries carry a signature instead of a session.
	'/api/webhooks/stripe',
	'/health',
	'/robots.txt'
]);
const publicPrefixes = [
	'/registrieren/',
	'/passwort-zuruecksetzen/',
	'/einladung/',
	'/e-mail-bestaetigen/',
	// Calendar apps subscribe without a session; the token in the path is the credential.
	'/api/calendar/',
	// Tenants open their portal through a link, without an account.
	'/mieterportal/'
];

/**
 * Paths whose posts check a password, hash a new one, create an account or send a reset mail,
 * counted per client address: the forms above, the pages of registration, reset and invitation
 * links, the account deletion, which asks for the password again, and the reports sent through a
 * Mieterportal link, which anyone with the link may post.
 */
const authPaths = new Set([
	'/anmelden',
	'/demo',
	'/registrieren',
	'/passwort-vergessen',
	'/einstellungen/konto'
]);
const authPrefixes = [
	'/registrieren/',
	'/passwort-zuruecksetzen/',
	'/einladung/',
	'/mieterportal/'
];

function isAuthPath(pathname: string): boolean {
	return authPaths.has(pathname) || authPrefixes.some((prefix) => pathname.startsWith(prefix));
}

/**
 * The API and the MCP server authenticate with an API key in the Authorization header and answer
 * in JSON, never with the session cookie or a redirect; see #lib/server/api/request.ts.
 */
function isApiPath(pathname: string): boolean {
	return pathname === '/api/v1' || pathname.startsWith('/api/v1/') || pathname === '/mcp';
}

function isPublic(pathname: string): boolean {
	// The demo has no sign-in: visitors start a demo account instead.
	if (DEMO) return pathname === '/demo' || pathname === '/health' || pathname === '/robots.txt';
	if (publicPaths.has(pathname)) return true;
	if (publicPrefixes.some((prefix) => pathname.startsWith(prefix))) return true;
	// Test-only endpoints, e.g. the seed. Only enabled by the end-to-end test server.
	return E2E && pathname.startsWith('/api/e2e/');
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.db = await getDatabase();
	event.locals.user = undefined;
	if (isApiPath(event.url.pathname)) {
		const response = await resolve(event);
		// Answers hold personal data like signed-in pages, so they are not cached either.
		applySecurityHeaders(response.headers, {
			https: event.url.protocol === 'https:',
			signedIn: true
		});
		return response;
	}

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

	if (!event.locals.user && !isPublic(event.url.pathname)) {
		redirect(303, DEMO ? '/demo' : '/anmelden');
	}
	// Counted with or without a session: a signed-in client can post to these actions as well.
	if (event.request.method === 'POST' && isAuthPath(event.url.pathname)) {
		const limiter = await getAuthLimiter();
		if (!(await limiter.limit(`auth:${event.getClientAddress()}`))) {
			error(429, 'Zu viele Versuche in kurzer Zeit. Bitte warte eine Minute.');
		}
	}
	// With BILLING_REQUIRED, an account without subscription after the trial may only read.
	if (event.locals.user) await enforceBilling(event);
	const response = await resolve(event);
	applySecurityHeaders(response.headers, {
		https: event.url.protocol === 'https:',
		signedIn: Boolean(event.locals.user)
	});
	// Only the demo's start page belongs in search engines; see routes/robots.txt.
	if (!(DEMO && event.url.pathname === '/demo')) {
		response.headers.set('X-Robots-Tag', 'noindex, nofollow');
	}
	return response;
};
