import { and, count, eq, exists, gt } from 'drizzle-orm';
import { revokeAllApiKeys } from './api-keys';
import { auditEntry } from './audit';
import {
	clearFailedAttempts,
	generateToken,
	hashPassword,
	hashToken,
	normalizeEmail
} from './auth';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { emailChanges, oauthCodes, passwordResets, sessions, users } from './db/schema';
import type { Mail } from './mail';

// Password resets (Passwort zurücksetzen): a link with a random token, valid for one hour. Only
// the SHA-256 of the token is stored, as the row's id. Using the link sets the new password,
// consumes every reset of the user and ends all their sessions.

export const PASSWORD_RESET_LIFETIME = 60 * 60 * 1000;
/** Open resets a user may have at once, i.e. requests within the lifetime of a link. */
export const MAX_OPEN_RESETS = 3;

export type PasswordResetRequest = { userId: string; email: string; token: string };

/**
 * Creates a reset for the address, or nothing when no user has it or the user already has
 * MAX_OPEN_RESETS open ones, so the form cannot be used to flood a mailbox. Requests are counted
 * apart from failed sign-ins: neither locks the other. The caller answers the same in every case.
 */
export async function requestPasswordReset(
	db: Database,
	email: string,
	now = Date.now()
): Promise<PasswordResetRequest | undefined> {
	email = normalizeEmail(email);
	const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
	if (!user) return undefined;
	const [open] = await db
		.select({ value: count() })
		.from(passwordResets)
		.where(and(eq(passwordResets.userId, user.id), gt(passwordResets.expiresAt, new Date(now))));
	if (open.value >= MAX_OPEN_RESETS) return undefined;
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
 * Sets the password of the user behind a valid token, deletes all resets, sessions, API keys and
 * pending address changes of the user and forgets the failed attempts of the address. The audit entry names neither the user
 * nor the address. Returns the user, so the caller can sign them in.
 *
 * Every statement of the batch only applies while the reset still exists, and the batch deletes
 * all resets of the user last. Of two simultaneous uses of one link, or of two links of one user,
 * only the first batch changes anything; the outcome is read back, as the salted hash is unique.
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
	const open = exists(
		db
			.select({ id: passwordResets.id })
			.from(passwordResets)
			.where(and(eq(passwordResets.id, reset.id), gt(passwordResets.expiresAt, new Date(now))))
	);
	await runBatch(db, [
		db
			.update(users)
			.set({ passwordHash })
			.where(and(eq(users.id, user.id), open)),
		db.delete(sessions).where(and(eq(sessions.userId, user.id), open)),
		db.delete(emailChanges).where(and(eq(emailChanges.userId, user.id), open)),
		revokeAllApiKeys(db, user.id, open),
		db.delete(oauthCodes).where(and(eq(oauthCodes.userId, user.id), open)),
		db.delete(passwordResets).where(and(eq(passwordResets.userId, user.id), open))
	]);
	const [stored] = await db
		.select({ passwordHash: users.passwordHash })
		.from(users)
		.where(eq(users.id, user.id));
	if (stored?.passwordHash !== passwordHash) return { ok: false };
	await auditEntry(
		db,
		{ accountId: user.accountId, userId: null },
		'user',
		user.id,
		'reset',
		'Passwort über einen Link zurückgesetzt'
	);
	await clearFailedAttempts(db, user.email);
	return { ok: true, userId: user.id };
}

/** The mail with the reset link; `link` is the absolute URL of /passwort-zuruecksetzen/<token>. */
export function passwordResetMail(to: string, link: string): Mail {
	return {
		to,
		subject: 'Passwort zurücksetzen | mietkartei',
		text:
			'Hallo,\n\n' +
			'du hast ein neues Passwort für mietkartei angefordert. Mit diesem Link kannst du es ' +
			'eine Stunde lang setzen:\n\n' +
			`${link}\n\n` +
			'Wenn du das nicht warst, kannst du diese E-Mail ignorieren; dein Passwort bleibt, wie es ist.\n'
	};
}
