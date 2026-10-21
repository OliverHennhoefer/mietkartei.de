import { and, count, eq, gt, lte } from 'drizzle-orm';
import { auditEntry, type AuditContext } from './audit';
import {
	checkCurrentPassword,
	otherSessions,
	generateToken,
	hashToken,
	normalizeEmail
} from './auth';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { emailChanges, passwordResets, sessions, users } from './db/schema';
import type { Mail } from './mail';
import { assertQuota } from './quotas';

// Changing the email address (E-Mail-Adresse ändern): the new address counts only once the link
// sent to it is opened, and the old address is told about the request. Only the SHA-256 of the
// token is stored, as the row's id. Confirming ends the user's other sessions and open resets.

const DAY = 24 * 60 * 60 * 1000;
export const EMAIL_CHANGE_LIFETIME = DAY;
/** Requests per user and day; each one sends two mails. */
export const MAX_EMAIL_CHANGES_PER_DAY = 5;

export type RequestEmailChangeResult =
	| { ok: true; token: string; email: string; previousEmail: string }
	| { ok: false; reason: 'wrong-password' | 'locked' | 'email-taken' | 'too-many' | 'missing' };

/**
 * Stores a request to move the signed-in user to a new address, after checking the current
 * password. Refused when a user already has the address or the user asked five times within a
 * day. Logged without the address. Returns the token for the mail, which is never stored.
 */
export async function requestEmailChange(
	db: Database,
	context: AuditContext,
	input: { email: string; currentPassword: string },
	now = Date.now()
): Promise<RequestEmailChangeResult> {
	if (!context.userId) return { ok: false, reason: 'missing' };
	const [user] = await db
		.select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
		.from(users)
		.where(and(eq(users.id, context.userId), eq(users.accountId, context.accountId)));
	if (!user) return { ok: false, reason: 'missing' };
	const checked = await checkCurrentPassword(db, user, input.currentPassword);
	if (checked !== 'ok') return { ok: false, reason: checked };
	const email = normalizeEmail(input.email);
	const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
	if (taken) return { ok: false, reason: 'email-taken' };
	await assertQuota(db, context.accountId, 'emailChanges');
	const [recent] = await db
		.select({ value: count() })
		.from(emailChanges)
		.where(and(eq(emailChanges.userId, user.id), gt(emailChanges.createdAt, new Date(now - DAY))));
	if (recent.value >= MAX_EMAIL_CHANGES_PER_DAY) return { ok: false, reason: 'too-many' };
	const token = generateToken();
	await runBatch(db, [
		// Expired requests are older than a day, so the count above never needs them.
		db
			.delete(emailChanges)
			.where(and(eq(emailChanges.userId, user.id), lte(emailChanges.expiresAt, new Date(now)))),
		db.insert(emailChanges).values({
			id: await hashToken(token),
			accountId: context.accountId,
			userId: user.id,
			email,
			expiresAt: new Date(now + EMAIL_CHANGE_LIFETIME),
			createdAt: new Date(now)
		}),
		auditEntry(db, context, 'user', user.id, 'update', 'Neue E-Mail-Adresse beantragt')
	]);
	return { ok: true, token, email, previousEmail: user.email };
}

/** The request behind a token, when it exists and has not expired. */
export async function findEmailChange(
	db: Database,
	token: string,
	now = Date.now()
): Promise<{ id: string; userId: string; email: string } | undefined> {
	const [row] = await db
		.select({ id: emailChanges.id, userId: emailChanges.userId, email: emailChanges.email })
		.from(emailChanges)
		.where(
			and(eq(emailChanges.id, await hashToken(token)), gt(emailChanges.expiresAt, new Date(now)))
		);
	return row;
}

export type ConfirmEmailChangeResult =
	{ ok: true; userId: string } | { ok: false; reason: 'invalid' | 'email-taken' };

/**
 * Moves the user to the confirmed address and deletes every request and reset of the user and
 * every session but the one of `keepToken`, so whoever had the account before the change is
 * signed out. Logged without the address.
 */
export async function confirmEmailChange(
	db: Database,
	token: string,
	keepToken: string | undefined,
	now = Date.now()
): Promise<ConfirmEmailChangeResult> {
	const change = await findEmailChange(db, token, now);
	if (!change) return { ok: false, reason: 'invalid' };
	const [user] = await db
		.select({ id: users.id, accountId: users.accountId })
		.from(users)
		.where(eq(users.id, change.userId));
	if (!user) return { ok: false, reason: 'invalid' };
	const [taken] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, change.email));
	if (taken) return { ok: false, reason: 'email-taken' };
	await runBatch(db, [
		db.update(users).set({ email: change.email }).where(eq(users.id, user.id)),
		db.delete(sessions).where(await otherSessions(user.id, keepToken)),
		db.delete(passwordResets).where(eq(passwordResets.userId, user.id)),
		db.delete(emailChanges).where(eq(emailChanges.userId, user.id)),
		auditEntry(
			db,
			{ accountId: user.accountId, userId: user.id },
			'user',
			user.id,
			'update',
			'E-Mail-Adresse geändert'
		)
	]);
	return { ok: true, userId: user.id };
}

/** The mail to the new address; `link` is the absolute URL of /e-mail-bestaetigen/<token>. */
export function emailChangeMail(to: string, link: string): Mail {
	return {
		to,
		subject: 'Neue E-Mail-Adresse bestätigen · mietkartei',
		text:
			'Hallo,\n\n' +
			'für einen Zugang zu mietkartei soll ab jetzt diese E-Mail-Adresse gelten. Mit diesem ' +
			'Link bestätigst du sie; er gilt einen Tag:\n\n' +
			`${link}\n\n` +
			'Wenn du das nicht warst, kannst du diese E-Mail ignorieren; dann bleibt alles, wie es ist.\n'
	};
}

/** The notice to the old address, which can stop the change by changing the password. */
export function emailChangeNoticeMail(to: string, newEmail: string): Mail {
	return {
		to,
		subject: 'Neue E-Mail-Adresse beantragt · mietkartei',
		text:
			'Hallo,\n\n' +
			`für deinen Zugang zu mietkartei wurde beantragt, die E-Mail-Adresse auf ${newEmail} zu ` +
			'ändern. Sie gilt erst, wenn jemand den Link in der E-Mail an diese Adresse öffnet.\n\n' +
			'Wenn du das nicht warst, ändere sofort dein Passwort oder setze es über „Passwort ' +
			'vergessen?“ zurück; damit verfällt die beantragte Änderung.\n'
	};
}
