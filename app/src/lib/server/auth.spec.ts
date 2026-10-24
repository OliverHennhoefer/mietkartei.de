import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database } from './db';
import {
	accounts,
	auditLog,
	emailChanges,
	loginAttempts,
	properties,
	sessions,
	users
} from './db/schema';
import { createSqliteDatabase } from './db/sqlite';
import { DEFAULT_ACCOUNT_ID, ensureDefaultAccount } from './accounts';
import {
	LOCKOUT_WINDOW,
	authenticate,
	changePassword,
	clearFailedAttempts,
	confirmPassword,
	createSession,
	deleteSession,
	generateToken,
	hashPassword,
	hashToken,
	isLockedOut,
	recordFailedAttempt,
	registerUser,
	SESSION_MAX_AGE,
	sessionCookieName,
	signIn,
	updateName,
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

	it('rejects hashes of another scheme or a cut-off hash', async () => {
		const hash = await hashPassword(password);
		const [, iterations, salt, expected] = hash.split('$');
		expect(await verifyPassword(password, `bcrypt$${iterations}$${salt}$${expected}`)).toBe(false);
		expect(await verifyPassword(password, `pbkdf2-sha256$${iterations}$${salt}`)).toBe(false);
		expect(
			await verifyPassword(password, `pbkdf2-sha256$${iterations}$${salt}$${expected.slice(0, 8)}`)
		).toBe(false);
	});

	it('salts every hash', async () => {
		expect(await hashPassword(password)).not.toBe(await hashPassword(password));
	});
});

describe('registration', () => {
	it('gives the first user the default account with the data entered before sign-in', async () => {
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
			accountId: DEFAULT_ACCOUNT_ID,
			role: 'owner'
		});
		const [property] = await db.select().from(properties);
		expect(property).toMatchObject({ name: 'Altes Haus', accountId: DEFAULT_ACCOUNT_ID });
	});

	it('lets managers but no second owner into an account, the default account too', async () => {
		await registerUser(db, 'erste@example.org', password);
		const passwordHash = await hashPassword(password);
		await db.insert(users).values({
			accountId: DEFAULT_ACCOUNT_ID,
			email: 'mitverwalter@example.org',
			passwordHash,
			role: 'manager'
		});
		await db.insert(users).values({
			accountId: DEFAULT_ACCOUNT_ID,
			email: 'noch-ein-mitverwalter@example.org',
			passwordHash,
			role: 'manager'
		});
		await expect(
			db.insert(users).values({
				accountId: DEFAULT_ACCOUNT_ID,
				email: 'zweite@example.org',
				passwordHash,
				role: 'owner'
			})
		).rejects.toThrow();
		expect(await db.select().from(users)).toHaveLength(3);
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

describe('registration races', () => {
	/** Lets `before` write to the database right before the user row is inserted. */
	function racing(before: () => void): Database {
		let done = false;
		return new Proxy(db, {
			get(target, property) {
				const value = Reflect.get(target, property);
				if (property !== 'insert') return value;
				return (table: unknown) => {
					if (table === users && !done) {
						done = true;
						before();
					}
					return target.insert(table as typeof users);
				};
			}
		});
	}

	it('reports a taken address and drops the new account when another registration wins', async () => {
		await registerUser(db, 'erste@example.org', password);
		const raced = racing(() =>
			db
				.insert(users)
				.values({
					accountId: DEFAULT_ACCOUNT_ID,
					email: 'zweite@example.org',
					passwordHash: 'x',
					role: 'manager'
				})
				.run()
		);
		expect(await registerUser(raced, 'zweite@example.org', password)).toEqual({
			ok: false,
			reason: 'email-taken'
		});
		expect(await db.select().from(accounts)).toHaveLength(1);
	});

	it('asks to try again when someone else became the first user meanwhile', async () => {
		const raced = racing(() =>
			db
				.insert(users)
				.values({
					accountId: DEFAULT_ACCOUNT_ID,
					email: 'schneller@example.org',
					passwordHash: 'x'
				})
				.run()
		);
		expect(await registerUser(raced, 'erste@example.org', password)).toEqual({
			ok: false,
			reason: 'retry'
		});
		expect(await db.select().from(accounts)).toHaveLength(1);
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

	it('never extends a session past the maximum age', async () => {
		const { token } = await signedIn();
		const signedInAt = new Date(Date.now() - SESSION_MAX_AGE + 24 * 60 * 60 * 1000);
		await db
			.update(sessions)
			.set({ createdAt: signedInAt, expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
		const validated = await validateSession(db, token);
		expect(validated?.expiresAt?.getTime()).toBe(signedInAt.getTime() + SESSION_MAX_AGE);

		await db.update(sessions).set({ expiresAt: validated!.expiresAt! });
		const again = await validateSession(db, token);
		expect(again?.user).toBeDefined();
		expect(again?.expiresAt).toBeUndefined();
	});

	it('ends a session on sign-out', async () => {
		const { token } = await signedIn();
		await deleteSession(db, token);
		expect(await validateSession(db, token)).toBeUndefined();
		expect(await db.select().from(sessions).where(eq(sessions.id, token))).toHaveLength(0);
	});
});

describe('sessionCookieName', () => {
	it('uses the __Host- prefix over https only', () => {
		expect(sessionCookieName(new URL('https://app.mietkartei.de/'))).toBe('__Host-session');
		expect(sessionCookieName(new URL('http://192.168.1.5:3000/'))).toBe('session');
	});
});

describe('lockout', () => {
	const email = 'erste@example.org';

	beforeEach(async () => {
		await registerUser(db, email, password);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('locks the address after five failures and refuses even the right password', async () => {
		for (let attempt = 1; attempt <= 4; attempt++) {
			expect(await signIn(db, email, 'falsch')).toEqual({ ok: false, reason: 'invalid' });
		}
		// The fifth failure is the one that locks.
		expect(await signIn(db, email, 'falsch')).toEqual({ ok: false, reason: 'locked' });
		expect(await signIn(db, email, password)).toEqual({ ok: false, reason: 'locked' });
		expect(await isLockedOut(db, email)).toBe(true);
		const [row] = await db.select().from(loginAttempts);
		expect(row.failures).toBe(5);
		expect(row.lockedUntil!.getTime() - Date.now()).toBeLessThanOrEqual(LOCKOUT_WINDOW);
	});

	it('counts unknown addresses too, ignoring case and spaces', async () => {
		for (let attempt = 1; attempt <= 5; attempt++) {
			await signIn(db, ' Niemand@Example.org', 'falsch');
		}
		expect(await isLockedOut(db, 'niemand@example.org')).toBe(true);
		const rows = await db.select().from(loginAttempts);
		expect(rows.map((row) => row.email)).toEqual(['niemand@example.org']);
	});

	it('clears the count on a successful sign-in', async () => {
		await signIn(db, email, 'falsch');
		await signIn(db, email, 'falsch');
		const result = await signIn(db, email, password);
		expect(result.ok).toBe(true);
		expect(await db.select().from(loginAttempts)).toEqual([]);
	});

	it('starts a new series when the first failure is older than the window', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const start = new Date('2026-03-01T10:00:00Z');
		vi.setSystemTime(start);
		for (let attempt = 1; attempt <= 4; attempt++) await signIn(db, email, 'falsch');
		// 16 minutes later the four failures no longer count.
		vi.setSystemTime(new Date(start.getTime() + 16 * 60 * 1000));
		expect(await signIn(db, email, 'falsch')).toEqual({ ok: false, reason: 'invalid' });
		const [row] = await db.select().from(loginAttempts);
		expect(row.failures).toBe(1);
		expect(row.lockedUntil).toBeNull();
	});

	it('opens the address again when the lock has run out', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const start = new Date('2026-03-01T10:00:00Z');
		vi.setSystemTime(start);
		for (let attempt = 1; attempt <= 5; attempt++) await signIn(db, email, 'falsch');
		expect(await isLockedOut(db, email)).toBe(true);
		vi.setSystemTime(new Date(start.getTime() + 15 * 60 * 1000 + 1));
		expect(await isLockedOut(db, email)).toBe(false);
		expect(await signIn(db, email, password)).toMatchObject({ ok: true });
	});

	it('records and clears attempts directly', async () => {
		const now = Date.parse('2026-03-01T10:00:00Z');
		for (let attempt = 1; attempt <= 4; attempt++) {
			expect(await recordFailedAttempt(db, email, now)).toEqual({
				failures: attempt,
				locked: false
			});
		}
		expect(await recordFailedAttempt(db, email, now)).toEqual({ failures: 5, locked: true });
		expect(await isLockedOut(db, email, now)).toBe(true);
		await clearFailedAttempts(db, email);
		expect(await isLockedOut(db, email, now)).toBe(false);
	});
});

describe('tokens', () => {
	it('generates distinct URL-safe tokens and hashes them to 64 hex characters', async () => {
		const first = generateToken();
		const second = generateToken();
		expect(first).not.toBe(second);
		expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(await hashToken(first)).toMatch(/^[0-9a-f]{64}$/);
		expect(await hashToken(first)).toBe(await hashToken(first));
		expect(await hashToken(first)).not.toBe(await hashToken(second));
		// SHA-256 of "abc", as every reference lists it.
		expect(await hashToken('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});

describe('changePassword', () => {
	async function userWithSessions() {
		const registered = await registerUser(db, 'erste@example.org', password);
		if (!registered.ok) throw new Error('registration failed');
		const [user] = await db.select().from(users).where(eq(users.id, registered.userId));
		const context = { accountId: user.accountId, userId: user.id };
		const current = await createSession(db, user.id);
		const other = await createSession(db, user.id);
		return { user, context, current, other };
	}

	it('sets the new password, keeps the current session, ends the others and logs without a user', async () => {
		const { user, context, current, other } = await userWithSessions();
		// The notice of an address change tells its owner to change the password to stop it.
		await db.insert(emailChanges).values({
			id: 'change',
			accountId: user.accountId,
			userId: user.id,
			email: 'fremd@example.org',
			expiresAt: new Date(Date.now() + 60_000)
		});
		expect(
			await changePassword(db, context, {
				currentPassword: password,
				password: 'ein-neues-passwort',
				keepToken: current.token
			})
		).toEqual({ ok: true });
		expect(await authenticate(db, user.email, 'ein-neues-passwort')).toBe(user.id);
		expect(await authenticate(db, user.email, password)).toBeUndefined();
		expect(await validateSession(db, current.token)).toBeDefined();
		expect(await validateSession(db, other.token)).toBeUndefined();
		expect(await db.select().from(emailChanges)).toEqual([]);
		const audit = await db.select().from(auditLog);
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({
			accountId: user.accountId,
			userId: null,
			entity: 'user',
			entityId: user.id,
			action: 'update',
			summary: 'Passwort geändert'
		});
		expect(audit[0].summary).not.toContain('@');
	});

	it('refuses a wrong current password and changes nothing', async () => {
		const { user, context, current, other } = await userWithSessions();
		expect(
			await changePassword(db, context, {
				currentPassword: 'falsch',
				password: 'ein-neues-passwort',
				keepToken: current.token
			})
		).toEqual({ ok: false, reason: 'wrong-password' });
		expect(await authenticate(db, user.email, password)).toBe(user.id);
		expect(await validateSession(db, other.token)).toBeDefined();
		expect(await db.select().from(auditLog)).toEqual([]);
	});

	it('does not change a user of another account', async () => {
		const { user, current } = await userWithSessions();
		const foreign = { accountId: 'other-account', userId: user.id };
		expect(
			await changePassword(db, foreign, {
				currentPassword: password,
				password: 'ein-neues-passwort',
				keepToken: current.token
			})
		).toEqual({ ok: false, reason: 'missing' });
	});

	it('counts wrong current passwords and refuses even the right one once locked', async () => {
		const { user, context, current } = await userWithSessions();
		const attempt = (currentPassword: string) =>
			changePassword(db, context, {
				currentPassword,
				password: 'ein-neues-passwort',
				keepToken: current.token
			});
		for (let failure = 1; failure <= 4; failure++) {
			expect(await attempt('falsch')).toEqual({ ok: false, reason: 'wrong-password' });
		}
		expect(await attempt('falsch')).toEqual({ ok: false, reason: 'locked' });
		expect(await attempt(password)).toEqual({ ok: false, reason: 'locked' });
		expect(await isLockedOut(db, user.email)).toBe(true);
		expect(await authenticate(db, user.email, password)).toBe(user.id);
	});
});

describe('changePassword without a user', () => {
	it('needs a signed-in user of the account', async () => {
		const input = {
			currentPassword: password,
			password: 'ganz-neues-passwort',
			keepToken: undefined
		};
		expect(
			await changePassword(db, { accountId: DEFAULT_ACCOUNT_ID, userId: null }, input)
		).toEqual({
			ok: false,
			reason: 'missing'
		});
		expect(
			await changePassword(db, { accountId: DEFAULT_ACCOUNT_ID, userId: 'gone' }, input)
		).toEqual({ ok: false, reason: 'missing' });
	});
});

describe('confirmPassword', () => {
	it('confirms the password of the user in their account only and counts wrong ones', async () => {
		const registered = await registerUser(db, 'erste@example.org', password);
		if (!registered.ok) throw new Error('registration failed');
		const [user] = await db.select().from(users).where(eq(users.id, registered.userId));
		const context = { accountId: user.accountId, userId: user.id };
		expect(await confirmPassword(db, context, password)).toBe('ok');
		expect(
			await confirmPassword(db, { accountId: 'other-account', userId: user.id }, password)
		).toBe('missing');
		expect(await confirmPassword(db, { accountId: user.accountId, userId: null }, password)).toBe(
			'missing'
		);
		for (let failure = 1; failure <= 4; failure++) {
			expect(await confirmPassword(db, context, 'falsch')).toBe('wrong-password');
		}
		expect(await confirmPassword(db, context, 'falsch')).toBe('locked');
		expect(await confirmPassword(db, context, password)).toBe('locked');
	});
});

describe('updateName', () => {
	it('changes the name of the user in the account only and logs it', async () => {
		const registered = await registerUser(db, 'erste@example.org', password);
		if (!registered.ok) throw new Error('registration failed');
		const [row] = await db.select().from(users).where(eq(users.id, registered.userId));
		await updateName(db, { accountId: 'other-account', userId: row.id }, 'Fremd');
		await updateName(db, { accountId: row.accountId, userId: null }, 'Niemand');
		await updateName(db, { accountId: row.accountId, userId: row.id }, 'Erika');
		const [updated] = await db.select().from(users).where(eq(users.id, row.id));
		expect(updated.name).toBe('Erika');
		expect(
			(await db.select().from(auditLog).where(eq(auditLog.accountId, row.accountId))).map(
				(entry) => entry.summary
			)
		).toEqual(['Name geändert']);
	});
});
