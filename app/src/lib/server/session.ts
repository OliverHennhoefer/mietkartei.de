import { redirect, type RequestEvent } from '@sveltejs/kit';
import { SESSION_COOKIE } from './auth';
import type { AuditContext } from './audit';

// Helpers for routes and hooks; the sign-in logic itself lives in auth.ts.

export function setSessionCookie(event: RequestEvent, token: string, expiresAt: Date) {
	event.cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// Self-hosted instances are often reached over plain HTTP in a private network, where a
		// secure cookie would never be sent back.
		secure: event.url.protocol === 'https:',
		expires: expiresAt
	});
}

/** The account of the signed-in user. The hook already redirects other requests; this narrows the type. */
export function requireAccount(locals: App.Locals): string {
	if (!locals.user) redirect(303, '/anmelden');
	return locals.user.accountId;
}

/** The context audit entries are written with: the signed-in user and their account. */
export function auditContext(locals: App.Locals): AuditContext {
	if (!locals.user) redirect(303, '/anmelden');
	return { accountId: locals.user.accountId, userId: locals.user.id };
}
