import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	authenticate,
	createSession,
	hashPassword,
	isLockedOut,
	signIn,
	validateSession
} from './auth';
import type { Database } from './db';
import { auditLog, emailChanges, loginAttempts, passwordResets, users } from './db/schema';
import {
	MAX_OPEN_RESETS,
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
	it('stores only the hash of the token, valid for one hour', async () => {
		const request = await requestPasswordReset(db, ' A@Example.org ', now);
		expect(request).toMatchObject({ userId: 'user-a', email: 'a@example.org' });
		const rows = await db.select().from(passwordResets);
		expect(rows).toHaveLength(1);
		expect(rows[0].id).not.toBe(request!.token);
		expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/);
		expect(rows[0].userId).toBe('user-a');
		expect(rows[0].expiresAt.getTime()).toBe(now + PASSWORD_RESET_LIFETIME);
	});

	it('answers nothing for an unknown address and stores nothing', async () => {
		expect(await requestPasswordReset(db, 'niemand@example.org', now)).toBeUndefined();
		expect(await db.select().from(passwordResets)).toEqual([]);
		expect(await db.select().from(loginAttempts)).toEqual([]);
	});

	it('sends no more links while the user has three open ones', async () => {
		for (let attempt = 1; attempt <= MAX_OPEN_RESETS; attempt++) {
			expect(await requestPasswordReset(db, 'a@example.org', now)).toBeDefined();
		}
		expect(await requestPasswordReset(db, 'a@example.org', now)).toBeUndefined();
		expect(await db.select().from(passwordResets)).toHaveLength(MAX_OPEN_RESETS);
		// Once they expired, a new link goes out.
		expect(
			await requestPasswordReset(db, 'a@example.org', now + PASSWORD_RESET_LIFETIME)
		).toBeDefined();
	});

	it('neither locks sign-in nor is locked by failed sign-ins', async () => {
		for (let attempt = 1; attempt <= MAX_OPEN_RESETS + 2; attempt++) {
			await requestPasswordReset(db, 'a@example.org', now);
		}
		expect(await isLockedOut(db, 'a@example.org', now)).toBe(false);
		expect(await signIn(db, 'a@example.org', password)).toMatchObject({ ok: true });

		await db.delete(passwordResets);
		await db.insert(loginAttempts).values({
			email: 'a@example.org',
			failures: 5,
			firstFailureAt: new Date(now),
			lockedUntil: new Date(now + 60_000)
		});
		expect(await isLockedOut(db, 'a@example.org', now)).toBe(true);
		expect(await requestPasswordReset(db, 'a@example.org', now)).toBeDefined();
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
	it('sets the password, ends every session, reset and address change of the user and logs it without a name', async () => {
		const request = await requestPasswordReset(db, 'a@example.org', now);
		const older = await requestPasswordReset(db, 'a@example.org', now);
		const session = await createSession(db, 'user-a');
		await db.insert(loginAttempts).values({
			email: 'a@example.org',
			failures: 2,
			firstFailureAt: new Date(now)
		});
		await db.insert(emailChanges).values({
			id: 'change',
			accountId: 'a',
			userId: 'user-a',
			email: 'neu@example.org',
			expiresAt: new Date(now + PASSWORD_RESET_LIFETIME)
		});

		const result = await resetPassword(db, request!.token, 'ein-neues-passwort', now);
		expect(result).toEqual({ ok: true, userId: 'user-a' });

		expect(await authenticate(db, 'a@example.org', 'ein-neues-passwort')).toBe('user-a');
		expect(await authenticate(db, 'a@example.org', password)).toBeUndefined();
		expect(await validateSession(db, session.token)).toBeUndefined();
		expect(await db.select().from(passwordResets)).toEqual([]);
		expect(await db.select().from(emailChanges)).toEqual([]);
		expect(await resetPassword(db, older!.token, 'noch-ein-passwort', now)).toEqual({ ok: false });
		// The reset forgets the failed sign-ins of the address.
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
