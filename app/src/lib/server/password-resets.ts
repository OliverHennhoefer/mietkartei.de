import { and, eq, gt } from 'drizzle-orm';
import { auditEntry } from './audit';
import {
	clearFailedAttempts,
	generateToken,
	hashPassword,
	hashToken,
	isLockedOut,
	normalizeEmail,
	recordFailedAttempt
} from './auth';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { passwordResets, sessions, users } from './db/schema';
import type { Mail } from './mail';

// Password resets (Passwort zurücksetzen): a link with a random token, valid for one hour. Only
// the SHA-256 of the token is stored, as the row's id. Using the link sets the new password,
// consumes every reset of the user and ends all their sessions.

export const PASSWORD_RESET_LIFETIME = 60 * 60 * 1000;

export type PasswordResetRequest = { userId: string; email: string; token: string };

/**
 * Creates a reset for the address, or nothing when no user has it or the address is locked.
 * Every request counts like a failed sign-in, so the form cannot be used to flood a mailbox.
 * The caller answers the same way in every case.
 */
export async function requestPasswordReset(
	db: Database,
	email: string,
	now = Date.now()
): Promise<PasswordResetRequest | undefined> {
	email = normalizeEmail(email);
	if (await isLockedOut(db, email, now)) return undefined;
	await recordFailedAttempt(db, email, now);
	const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
	if (!user) return undefined;
	const token = generateToken();
	await db.insert(passwordResets).values({
		id: await hashToken(token),
		userId: user.id,
		expiresAt: new Date(now + PASSWORD_RESET_LIFETIME)
	});
	return { userId: user.id, email, token };
}

/** The reset behind a token, when it exists and has not expired. */
export async function findPasswordReset(
	db: Database,
	token: string,
	now = Date.now()
): Promise<{ id: string; userId: string } | undefined> {
	const id = await hashToken(token);
	const [row] = await db
		.select({ id: passwordResets.id, userId: passwordResets.userId })
		.from(passwordResets)
		.where(and(eq(passwordResets.id, id), gt(passwordResets.expiresAt, new Date(now))));
	return row;
}

/**
 * Sets the password of the user behind a valid token, deletes all resets and sessions of the
 * user and forgets the failed attempts of the address. The audit entry names neither the user
 * nor the address. Returns the user, so the caller can sign them in.
 */
export async function resetPassword(
	db: Database,
	token: string,
	password: string,
	now = Date.now()
): Promise<{ ok: true; userId: string } | { ok: false }> {
	const reset = await findPasswordReset(db, token, now);
	if (!reset) return { ok: false };
	const [user] = await db
		.select({ id: users.id, accountId: users.accountId, email: users.email })
		.from(users)
		.where(eq(users.id, reset.userId));
	if (!user) return { ok: false };
	const passwordHash = await hashPassword(password);
	await runBatch(db, [
		db.update(users).set({ passwordHash }).where(eq(users.id, user.id)),
		db.delete(sessions).where(eq(sessions.userId, user.id)),
		db.delete(passwordResets).where(eq(passwordResets.userId, user.id)),
		auditEntry(
			db,
			{ accountId: user.accountId, userId: null },
			'user',
			user.id,
			'reset',
			'Passwort über einen Link zurückgesetzt'
		)
	]);
	await clearFailedAttempts(db, user.email);
	return { ok: true, userId: user.id };
}

function isLoopback(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '[::1]' || /^127(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * The origin for the link in a reset mail, or undefined when the request cannot be trusted with
 * it. The mail goes to someone other than the sender of the request, so the link must not
 * follow a Host header the sender chose: ORIGIN wins when set; on Workers the request URL is the
 * host Cloudflare routed to the app; on node without ORIGIN the Host header is the client's, and
 * only a loopback address is accepted, because a link to localhost cannot lead to a foreign site.
 */
export function resetLinkOrigin(
	url: URL,
	configuredOrigin: string,
	target: 'node' | 'cloudflare'
): string | undefined {
	if (configuredOrigin) return new URL(configuredOrigin).origin;
	if (target === 'cloudflare' || isLoopback(url.hostname)) return url.origin;
	return undefined;
}

/** The mail with the reset link; `link` is the absolute URL of /passwort-zuruecksetzen/<token>. */
export function passwordResetMail(to: string, link: string): Mail {
	return {
		to,
		subject: 'Passwort zurücksetzen · mietkartei',
		text:
			'Hallo,\n\n' +
			'du hast ein neues Passwort für mietkartei angefordert. Mit diesem Link kannst du es ' +
			'eine Stunde lang setzen:\n\n' +
			`${link}\n\n` +
			'Wenn du das nicht warst, kannst du diese E-Mail ignorieren; dein Passwort bleibt, wie es ist.\n'
	};
}
