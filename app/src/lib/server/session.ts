import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { sessionCookieName, type SessionUser } from './auth';
import type { AuditContext } from './audit';

// Helpers for routes and hooks; the sign-in logic itself lives in auth.ts.

export function setSessionCookie(event: RequestEvent, token: string, expiresAt: Date) {
	event.cookies.set(sessionCookieName(event.url), token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// Self-hosted instances are often reached over plain HTTP in a private network, where a
		// secure cookie would never be sent back.
		secure: event.url.protocol === 'https:',
		expires: expiresAt
	});
}

export function getSessionToken(event: Pick<RequestEvent, 'cookies' | 'url'>): string | undefined {
	return event.cookies.get(sessionCookieName(event.url));
}

export function deleteSessionCookie(event: Pick<RequestEvent, 'cookies' | 'url'>) {
	event.cookies.delete(sessionCookieName(event.url), {
		path: '/',
		secure: event.url.protocol === 'https:'
	});
}

/** The account of the signed-in user. The hook already redirects other requests; this narrows the type. */
export function requireAccount(locals: App.Locals): string {
	if (!locals.user) redirect(303, '/anmelden');
	return locals.user.accountId;
}

/** The signed-in user, for audit entries and ownership checks. */
export function requireUser(locals: App.Locals): SessionUser {
	if (!locals.user) redirect(303, '/anmelden');
	return locals.user;
}

/** Owners only: invitations and bank accounts. */
export function requireOwner(locals: App.Locals): SessionUser {
	const user = requireUser(locals);
	if (user.role !== 'owner') error(403, 'Das dürfen nur Vermieter, keine Mitverwalter.');
	return user;
}

/** The context audit entries are written with: the signed-in user and their account. */
export function auditContext(locals: App.Locals): AuditContext {
	if (!locals.user) redirect(303, '/anmelden');
	return { accountId: locals.user.accountId, userId: locals.user.id };
}
