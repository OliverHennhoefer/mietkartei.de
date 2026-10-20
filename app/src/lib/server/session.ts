import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { SESSION_COOKIE, type SessionUser } from './auth';

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

/** The signed-in user, for audit entries and ownership checks. */
export function requireUser(locals: App.Locals): SessionUser {
	if (!locals.user) redirect(303, '/anmelden');
	return locals.user;
}

/** Owners only: invitations, bank accounts, billing, deleting the account. */
export function requireOwner(locals: App.Locals): SessionUser {
	const user = requireUser(locals);
	if (user.role !== 'owner') error(403, 'Das dürfen nur Vermieter, keine Mitverwalter.');
	return user;
}

/** The context audit entries are written with. */
export function auditContext(locals: App.Locals): { accountId: string; userId: string } {
	const user = requireUser(locals);
	return { accountId: user.accountId, userId: user.id };
}
