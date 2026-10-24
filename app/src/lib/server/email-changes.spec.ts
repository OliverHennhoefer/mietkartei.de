import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate, createSession, hashPassword, isLockedOut, validateSession } from './auth';
import type { Database } from './db';
import { auditLog, emailChanges, passwordResets, users } from './db/schema';
import {
	EMAIL_CHANGE_LIFETIME,
	MAX_EMAIL_CHANGES_PER_DAY,
	confirmEmailChange,
	deliverEmailChange,
	emailChangeMail,
	emailChangeNoticeMail,
	findEmailChange,
	requestEmailChange
} from './email-changes';
import { QUOTAS } from './quotas';
import { contextA, testDatabase } from './testing';

const password = 'richtig-langes-passwort';
const now = Date.parse('2026-03-01T10:00:00Z');
const later = now + EMAIL_CHANGE_LIFETIME;

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	await db
		.update(users)
		.set({ passwordHash: await hashPassword(password) })
		.where(eq(users.id, 'user-a'));
});

async function request(email = 'Neu@Example.org', at = now) {
	const result = await requestEmailChange(db, contextA, { email, currentPassword: password }, at);
	if (!result.ok) throw new Error(result.reason);
	return result;
}

describe('requestEmailChange', () => {
	it('stores the hash of the token for a day, keeps the address and logs without it', async () => {
		const result = await request();
		expect(result).toMatchObject({
			ok: true,
			email: 'neu@example.org',
			previousEmail: 'a@example.org'
		});
		const [row] = await db.select().from(emailChanges);
		expect(row).toMatchObject({ accountId: 'a', userId: 'user-a', email: 'neu@example.org' });
		expect(row.id).not.toBe(result.token);
		expect(row.id).toMatch(/^[0-9a-f]{64}$/);
		expect(row.expiresAt.getTime()).toBe(later);
		const [user] = await db.select().from(users).where(eq(users.id, 'user-a'));
		expect(user.email).toBe('a@example.org');
		const audit = await db.select().from(auditLog);
		expect(audit.map((entry) => entry.summary)).toEqual(['Neue E-Mail-Adresse beantragt']);
		expect(audit[0].summary).not.toContain('example.org');
	});

	it('needs the current password, counted like a failed sign-in', async () => {
		const attempt = (currentPassword: string) =>
			requestEmailChange(db, contextA, { email: 'neu@example.org', currentPassword }, now);
		for (let failure = 1; failure <= 4; failure++) {
			expect(await attempt('falsch')).toEqual({ ok: false, reason: 'wrong-password' });
		}
		expect(await attempt('falsch')).toEqual({ ok: false, reason: 'locked' });
		expect(await isLockedOut(db, 'a@example.org')).toBe(true);
		expect(await attempt(password)).toEqual({ ok: false, reason: 'locked' });
		expect(await db.select().from(emailChanges)).toEqual([]);
	});

	it('refuses an address another user has, in any account', async () => {
		expect(
			await requestEmailChange(
				db,
				contextA,
				{ email: 'B@example.org', currentPassword: password },
				now
			)
		).toEqual({ ok: false, reason: 'email-taken' });
	});

	it('takes five requests a day and drops expired ones', async () => {
		for (let index = 0; index < MAX_EMAIL_CHANGES_PER_DAY; index++) {
			await request(`neu-${index}@example.org`);
		}
		expect(
			await requestEmailChange(
				db,
				contextA,
				{ email: 'noch@example.org', currentPassword: password },
				now
			)
		).toEqual({ ok: false, reason: 'too-many' });
		await request('noch@example.org', later);
		expect((await db.select().from(emailChanges)).map((row) => row.email)).toEqual([
			'noch@example.org'
		]);
	});

	it('refuses with 409 once the account holds the most requests it may', async () => {
		await db.insert(emailChanges).values(
			Array.from({ length: QUOTAS.emailChanges.max }, (_, index) => ({
				id: `change-${index}`,
				accountId: 'a',
				userId: 'user-a',
				email: `alt-${index}@example.org`,
				expiresAt: new Date(later),
				createdAt: new Date(now - EMAIL_CHANGE_LIFETIME)
			}))
		);
		const refusal = await request().catch((error) => error);
		expect(isHttpError(refusal, 409)).toBe(true);
	});
});

describe('deliverEmailChange', () => {
	const toNew = { to: 'neu@example.org', subject: 'Bestätigen', text: 'Link' };
	const toOld = { to: 'a@example.org', subject: 'Hinweis', text: 'Neue Adresse' };

	it('sends both mails and keeps the request', async () => {
		const result = await request();
		const send = vi.fn(async () => {});
		expect(await deliverEmailChange(db, result.token, [toNew, toOld], send)).toBe(true);
		expect(send.mock.calls).toEqual([[toNew], [toOld]]);
		expect(await findEmailChange(db, result.token, now)).toBeDefined();
	});

	it('withdraws the request when a mail fails, even after the link went out', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await request();
		const sent: string[] = [];
		const failOnNotice = async (mail: { to: string }) => {
			if (mail.to === toOld.to) throw new Error('Mail provider answered 500');
			sent.push(mail.to);
		};
		expect(await deliverEmailChange(db, result.token, [toNew, toOld], failOnNotice)).toBe(false);
		expect(sent).toEqual([toNew.to]);
		expect(await findEmailChange(db, result.token, now)).toBeUndefined();
		expect(await db.select().from(emailChanges)).toEqual([]);
		vi.restoreAllMocks();
	});
});

describe('confirmEmailChange', () => {
	it('moves the user, ends the other sessions, resets and requests and logs it', async () => {
		const { token } = await request();
		const other = await request('anders@example.org');
		const current = await createSession(db, 'user-a');
		const elsewhere = await createSession(db, 'user-a');
		const sessionB = await createSession(db, 'user-b');
		await db
			.insert(passwordResets)
			.values({ id: 'r', userId: 'user-a', expiresAt: new Date(later) });

		expect(await findEmailChange(db, token, now)).toMatchObject({ email: 'neu@example.org' });
		expect(await confirmEmailChange(db, token, current.token, now)).toEqual({
			ok: true,
			userId: 'user-a'
		});
		expect(await authenticate(db, 'neu@example.org', password)).toBe('user-a');
		expect(await authenticate(db, 'a@example.org', password)).toBeUndefined();
		expect(await validateSession(db, current.token)).toBeDefined();
		expect(await validateSession(db, elsewhere.token)).toBeUndefined();
		expect(await validateSession(db, sessionB.token)).toBeDefined();
		expect(await db.select().from(passwordResets)).toEqual([]);
		expect(await db.select().from(emailChanges)).toEqual([]);
		// Used up, and so is the other request.
		expect(await confirmEmailChange(db, token, undefined, now)).toEqual({
			ok: false,
			reason: 'invalid'
		});
		expect(await confirmEmailChange(db, other.token, undefined, now)).toEqual({
			ok: false,
			reason: 'invalid'
		});
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'update'));
		expect(audit.map((entry) => entry.summary)).toContain('E-Mail-Adresse geändert');
		// No address, old or new, ends up in the log.
		for (const entry of audit) expect(entry.summary).not.toContain('@');
	});

	it('ends every session when the browser has none of the user', async () => {
		const { token } = await request();
		const session = await createSession(db, 'user-a');
		expect(await confirmEmailChange(db, token, undefined, now)).toMatchObject({ ok: true });
		expect(await validateSession(db, session.token)).toBeUndefined();
	});

	it('refuses an expired or unknown link and an address taken in the meantime', async () => {
		const { token } = await request();
		expect(await confirmEmailChange(db, token, undefined, later)).toEqual({
			ok: false,
			reason: 'invalid'
		});
		expect(await confirmEmailChange(db, 'unbekannt', undefined, now)).toEqual({
			ok: false,
			reason: 'invalid'
		});
		await db.update(users).set({ email: 'neu@example.org' }).where(eq(users.id, 'user-b'));
		expect(await confirmEmailChange(db, token, undefined, now)).toEqual({
			ok: false,
			reason: 'email-taken'
		});
		const [user] = await db.select().from(users).where(eq(users.id, 'user-a'));
		expect(user.email).toBe('a@example.org');
	});
});

describe('emailChangeMail and emailChangeNoticeMail', () => {
	it('send the link to the new address and the notice to the old one', () => {
		const mail = emailChangeMail('neu@example.org', 'https://app.example/e-mail-bestaetigen/t0k');
		expect(mail.to).toBe('neu@example.org');
		expect(mail.text).toContain('https://app.example/e-mail-bestaetigen/t0k');
		const notice = emailChangeNoticeMail('a@example.org', 'neu@example.org');
		expect(notice.to).toBe('a@example.org');
		expect(notice.text).toContain('neu@example.org');
		expect(notice.text).toContain('Passwort');
		expect(notice.text).not.toContain('http');
	});
});
