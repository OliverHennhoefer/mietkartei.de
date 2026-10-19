import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database } from './db';
import { accounts, properties, sessions, users } from './db/schema';
import { createSqliteDatabase } from './db/sqlite';
import { DEFAULT_ACCOUNT_ID, ensureDefaultAccount } from './accounts';
import {
	authenticate,
	createSession,
	deleteSession,
	hashPassword,
	registerUser,
	validateSession,
	verifyPassword
} from './auth';

const password = 'richtig-langes-passwort';

let db: Database;

beforeEach(() => {
	db = createSqliteDatabase(':memory:');
});

describe('passwords', () => {
	it('verifies the right password and rejects a wrong one', async () => {
		const hash = await hashPassword(password);
		expect(hash).toMatch(/^pbkdf2-sha256\$100000\$/);
		expect(await verifyPassword(password, hash)).toBe(true);
		expect(await verifyPassword('falsches-passwort', hash)).toBe(false);
	});

	it('salts every hash', async () => {
		expect(await hashPassword(password)).not.toBe(await hashPassword(password));
	});
});

describe('registration', () => {
	it('gives the first user the default account and its existing data', async () => {
		await ensureDefaultAccount(db);
		await db.insert(properties).values({
			accountId: DEFAULT_ACCOUNT_ID,
			name: 'Altes Haus',
			street: 'Am Markt 1',
			postalCode: '04109',
			city: 'Leipzig'
		});

		const result = await registerUser(db, 'Erste@Example.org ', password);
		expect(result.ok).toBe(true);
		const session = await createSession(db, result.ok ? result.userId : '');
		const validated = await validateSession(db, session.token);
		expect(validated?.user).toMatchObject({
			email: 'erste@example.org',
			accountId: DEFAULT_ACCOUNT_ID
		});
	});

	it('never gives the default account to a second user', async () => {
		await registerUser(db, 'erste@example.org', password);
		await expect(
			db.insert(users).values({
				accountId: DEFAULT_ACCOUNT_ID,
				email: 'zweite@example.org',
				passwordHash: await hashPassword(password)
			})
		).rejects.toThrow();
	});

	it('gives every later user a new account', async () => {
		await registerUser(db, 'erste@example.org', password);
		const second = await registerUser(db, 'zweite@example.org', password);
		expect(second.ok).toBe(true);
		const rows = await db.select().from(accounts);
		expect(rows).toHaveLength(2);
	});

	it('rejects an email address that is already registered', async () => {
		await registerUser(db, 'erste@example.org', password);
		expect(await registerUser(db, 'ERSTE@example.org', password)).toEqual({
			ok: false,
			reason: 'email-taken'
		});
	});
});

describe('sign-in', () => {
	it('accepts the right password, ignoring case and spaces in the email', async () => {
		const registered = await registerUser(db, 'erste@example.org', password);
		const userId = await authenticate(db, ' Erste@Example.org', password);
		expect(userId).toBe(registered.ok ? registered.userId : undefined);
	});

	it('rejects a wrong password and an unknown email', async () => {
		await registerUser(db, 'erste@example.org', password);
		expect(await authenticate(db, 'erste@example.org', 'falsches-passwort')).toBeUndefined();
		expect(await authenticate(db, 'niemand@example.org', password)).toBeUndefined();
	});
});

describe('sessions', () => {
	async function signedIn() {
		const registered = await registerUser(db, 'erste@example.org', password);
		if (!registered.ok) throw new Error('registration failed');
		return createSession(db, registered.userId);
	}

	it('stores only a hash of the token', async () => {
		const { token } = await signedIn();
		const rows = await db.select().from(sessions);
		expect(rows).toHaveLength(1);
		expect(rows[0].id).not.toBe(token);
	});

	it('rejects an unknown token', async () => {
		await signedIn();
		expect(await validateSession(db, 'unbekannt')).toBeUndefined();
	});

	it('deletes an expired session', async () => {
		const { token } = await signedIn();
		await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
		expect(await validateSession(db, token)).toBeUndefined();
		expect(await db.select().from(sessions)).toHaveLength(0);
	});

	it('extends a session that is close to expiry', async () => {
		const { token } = await signedIn();
		const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
		await db.update(sessions).set({ expiresAt: soon });
		const validated = await validateSession(db, token);
		expect(validated?.expiresAt?.getTime()).toBeGreaterThan(soon.getTime());
	});

	it('ends a session on sign-out', async () => {
		const { token } = await signedIn();
		await deleteSession(db, token);
		expect(await validateSession(db, token)).toBeUndefined();
		expect(await db.select().from(sessions).where(eq(sessions.id, token))).toHaveLength(0);
	});
});
