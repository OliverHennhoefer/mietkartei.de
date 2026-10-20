import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { authenticate, createSession, hashPassword, isLockedOut, validateSession } from './auth';
import type { Database } from './db';
import { auditLog, loginAttempts, passwordResets, users } from './db/schema';
import {
	PASSWORD_RESET_LIFETIME,
	findPasswordReset,
	passwordResetMail,
	requestPasswordReset,
	resetPassword
} from './password-resets';
import { testDatabase } from './testing';

const password = 'richtig-langes-passwort';
const now = Date.parse('2026-03-01T10:00:00Z');

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	await db
		.update(users)
		.set({ passwordHash: await hashPassword(password) })
		.where(eq(users.id, 'user-a'));
});

describe('requestPasswordReset', () => {
	it('stores only the hash of the token, valid for one hour, and counts the request', async () => {
		const request = await requestPasswordReset(db, ' A@Example.org ', now);
		expect(request).toMatchObject({ userId: 'user-a', email: 'a@example.org' });
		const rows = await db.select().from(passwordResets);
		expect(rows).toHaveLength(1);
		expect(rows[0].id).not.toBe(request!.token);
		expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/);
		expect(rows[0].userId).toBe('user-a');
		expect(rows[0].expiresAt.getTime()).toBe(now + PASSWORD_RESET_LIFETIME);
		const [attempt] = await db.select().from(loginAttempts);
		expect(attempt).toMatchObject({ email: 'a@example.org', failures: 1 });
	});

	it('answers nothing for an unknown address but still counts it', async () => {
		expect(await requestPasswordReset(db, 'niemand@example.org', now)).toBeUndefined();
		expect(await db.select().from(passwordResets)).toEqual([]);
		const [attempt] = await db.select().from(loginAttempts);
		expect(attempt).toMatchObject({ email: 'niemand@example.org', failures: 1 });
	});

	it('sends nothing to a locked address', async () => {
		for (let attempt = 1; attempt <= 5; attempt++)
			await requestPasswordReset(db, 'a@example.org', now);
		expect(await isLockedOut(db, 'a@example.org', now)).toBe(true);
		expect(await db.select().from(passwordResets)).toHaveLength(5);
		expect(await requestPasswordReset(db, 'a@example.org', now)).toBeUndefined();
		expect(await db.select().from(passwordResets)).toHaveLength(5);
	});
});

describe('findPasswordReset', () => {
	it('finds a valid token and ignores an expired or unknown one', async () => {
		const request = await requestPasswordReset(db, 'a@example.org', now);
		expect(await findPasswordReset(db, request!.token, now)).toMatchObject({ userId: 'user-a' });
		expect(
			await findPasswordReset(db, request!.token, now + PASSWORD_RESET_LIFETIME)
		).toBeUndefined();
		expect(await findPasswordReset(db, 'unbekannt', now)).toBeUndefined();
	});
});

describe('resetPassword', () => {
	it('sets the password, ends every session and reset of the user and logs it without a name', async () => {
		const request = await requestPasswordReset(db, 'a@example.org', now);
		const older = await requestPasswordReset(db, 'a@example.org', now);
		const session = await createSession(db, 'user-a');

		const result = await resetPassword(db, request!.token, 'ein-neues-passwort', now);
		expect(result).toEqual({ ok: true, userId: 'user-a' });

		expect(await authenticate(db, 'a@example.org', 'ein-neues-passwort')).toBe('user-a');
		expect(await authenticate(db, 'a@example.org', password)).toBeUndefined();
		expect(await validateSession(db, session.token)).toBeUndefined();
		expect(await db.select().from(passwordResets)).toEqual([]);
		expect(await resetPassword(db, older!.token, 'noch-ein-passwort', now)).toEqual({ ok: false });
		// The two requests counted as attempts; the reset forgets them.
		expect(await db.select().from(loginAttempts)).toEqual([]);

		const audit = await db.select().from(auditLog);
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({
			accountId: 'a',
			userId: null,
			entity: 'user',
			entityId: 'user-a',
			action: 'reset',
			summary: 'Passwort über einen Link zurückgesetzt'
		});
		expect(audit[0].summary).not.toContain('@');
	});

	it('refuses an expired token and keeps the old password', async () => {
		const request = await requestPasswordReset(db, 'a@example.org', now);
		expect(
			await resetPassword(db, request!.token, 'ein-neues-passwort', now + PASSWORD_RESET_LIFETIME)
		).toEqual({ ok: false });
		expect(await authenticate(db, 'a@example.org', password)).toBe('user-a');
		expect(await db.select().from(auditLog)).toEqual([]);
	});

	it('does not touch another account', async () => {
		await db
			.update(users)
			.set({ passwordHash: await hashPassword(password) })
			.where(eq(users.id, 'user-b'));
		const sessionB = await createSession(db, 'user-b');
		const request = await requestPasswordReset(db, 'a@example.org', now);
		await resetPassword(db, request!.token, 'ein-neues-passwort', now);
		expect(await authenticate(db, 'b@example.org', password)).toBe('user-b');
		expect(await validateSession(db, sessionB.token)).toBeDefined();
		expect(await db.select().from(auditLog).where(eq(auditLog.accountId, 'b'))).toEqual([]);
	});
});

describe('passwordResetMail', () => {
	it('carries the link and nothing personal', () => {
		const mail = passwordResetMail(
			'a@example.org',
			'https://app.example/passwort-zuruecksetzen/t0k'
		);
		expect(mail.to).toBe('a@example.org');
		expect(mail.subject).toContain('Passwort');
		expect(mail.text).toContain('https://app.example/passwort-zuruecksetzen/t0k');
	});
});
