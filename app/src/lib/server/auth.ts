import { and, count, eq, ne } from 'drizzle-orm';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import {
	accounts,
	apiKeys,
	emailChanges,
	loginAttempts,
	sessions,
	users,
	type UserRole
} from './db/schema';
import { DEFAULT_ACCOUNT_ID, ensureDefaultAccount } from './accounts';

// Sign-in uses only WebCrypto, which Node and Workers both provide, so both targets behave the same.

/**
 * The cookie name over https has the __Host- prefix: browsers then accept it only with Secure,
 * Path=/ and no Domain, so no other site on a subdomain can set or overwrite it. Self-hosted
 * instances on plain http keep the bare name, which the prefix would not allow.
 */
export function sessionCookieName(url: URL): string {
	return url.protocol === 'https:' ? '__Host-session' : 'session';
}

const DAY = 24 * 60 * 60 * 1000;
const SESSION_LIFETIME = 30 * DAY;
/** A session used within its last 15 days is extended, so active users stay signed in. */
const SESSION_RENEWAL = 15 * DAY;
/** However active, a session ends this long after sign-in, so a stolen cookie stops working. */
export const SESSION_MAX_AGE = 90 * DAY;

// Workers cap PBKDF2 at 100,000 iterations.
const PBKDF2_ITERATIONS = 100_000;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function toBase64Url(bytes: Uint8Array): string {
	return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
	const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
		'deriveBits'
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
		key,
		256
	);
	return new Uint8Array(bits);
}

/** Returns a self-describing hash: `pbkdf2-sha256$<iterations>$<salt>$<hash>`. */
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
	return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, iterations, salt, expected] = stored.split('$');
	if (scheme !== 'pbkdf2-sha256' || !iterations || !salt || !expected) return false;
	const actual = await pbkdf2(password, fromBase64(salt), Number(iterations));
	const expectedBytes = fromBase64(expected);
	if (actual.length !== expectedBytes.length) return false;
	// Compare every byte so the time taken does not reveal how much of the hash matched.
	let difference = 0;
	for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expectedBytes[i];
	return difference === 0;
}

// Verifying against this when the email is unknown keeps the response time the same, so the
// login form does not reveal which addresses have an account. Created on first use, because
// Workers do not allow random values outside a request.
let unknownUserHash: Promise<string> | undefined;

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export async function hasUsers(db: Database): Promise<boolean> {
	const [{ value }] = await db.select({ value: count() }).from(users);
	return value > 0;
}

export type RegisterResult =
	| { ok: true; userId: string }
	| { ok: false; reason: 'email-taken' }
	/** Someone else registered as the first user at the same moment. */
	| { ok: false; reason: 'retry' };

/**
 * The first user takes over the default account and with it any data entered before sign-in
 * existed. Every later user gets a new, empty account.
 */
export async function registerUser(
	db: Database,
	email: string,
	password: string
): Promise<RegisterResult> {
	email = normalizeEmail(email);
	const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
	if (existing) return { ok: false, reason: 'email-taken' };

	const passwordHash = await hashPassword(password);
	const first = !(await hasUsers(db));
	let accountId: string;
	if (first) {
		accountId = await ensureDefaultAccount(db);
	} else {
		const [account] = await db.insert(accounts).values({ name: email }).returning();
		accountId = account.id;
	}

	try {
		const [user] = await db
			.insert(users)
			.values({ accountId, email, passwordHash })
			.returning({ id: users.id });
		return { ok: true, userId: user.id };
	} catch (error) {
		// Another registration won a race: for the same address, or for the owner of the default
		// account (users_account_owner_unique).
		if (accountId !== DEFAULT_ACCOUNT_ID)
			await db.delete(accounts).where(eq(accounts.id, accountId));
		const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
		if (taken) return { ok: false, reason: 'email-taken' };
		if (first && (await hasUsers(db))) return { ok: false, reason: 'retry' };
		throw error;
	}
}

/** Returns the user's id when the email and password match. */
export async function authenticate(
	db: Database,
	email: string,
	password: string
): Promise<string | undefined> {
	const [user] = await db
		.select({ id: users.id, passwordHash: users.passwordHash })
		.from(users)
		.where(eq(users.email, normalizeEmail(email)));
	if (!user) {
		unknownUserHash ??= hashPassword(crypto.randomUUID());
		await verifyPassword(password, await unknownUserHash);
		return undefined;
	}
	return (await verifyPassword(password, user.passwordHash)) ? user.id : undefined;
}

async function sessionId(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
	return toBase64Url(new Uint8Array(digest));
}

/** Creates a session and returns the token for the cookie. Only its hash is stored. */
export async function createSession(db: Database, userId: string) {
	const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
	const expiresAt = new Date(Date.now() + SESSION_LIFETIME);
	await db.insert(sessions).values({ id: await sessionId(token), userId, expiresAt });
	return { token, expiresAt };
}

export type SessionUser = {
	id: string;
	email: string;
	accountId: string;
	name: string | null;
	role: UserRole;
};

/**
 * Looks up the user of a session token. Expired sessions are deleted; sessions close to expiry
 * are extended up to SESSION_MAX_AGE after sign-in, in which case `expiresAt` is set and the
 * cookie must be renewed.
 */
export async function validateSession(
	db: Database,
	token: string
): Promise<{ user: SessionUser; expiresAt?: Date } | undefined> {
	const id = await sessionId(token);
	const [row] = await db
		.select({
			expiresAt: sessions.expiresAt,
			createdAt: sessions.createdAt,
			user: {
				id: users.id,
				email: users.email,
				accountId: users.accountId,
				name: users.name,
				role: users.role
			}
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, id));
	if (!row) return undefined;

	const now = Date.now();
	if (row.expiresAt.getTime() <= now) {
		await db.delete(sessions).where(eq(sessions.id, id));
		return undefined;
	}
	const maxExpiry = row.createdAt.getTime() + SESSION_MAX_AGE;
	if (row.expiresAt.getTime() - now < SESSION_RENEWAL && row.expiresAt.getTime() < maxExpiry) {
		const expiresAt = new Date(Math.min(now + SESSION_LIFETIME, maxExpiry));
		await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
		return { user: row.user, expiresAt };
	}
	return { user: row.user };
}

export async function deleteSession(db: Database, token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.id, await sessionId(token)));
}

// Lockout (login_attempts): failed sign-ins are counted per address, whether or not the address
// has an account, so the lock does not reveal which addresses exist. Reset requests are limited
// on their own (password-resets.ts), so neither can lock the other.

const MAX_FAILED_ATTEMPTS = 5;
/** Failures are counted within this window; a lock lasts as long. */
export const LOCKOUT_WINDOW = 15 * 60 * 1000;

/** Whether the address is locked at `now`. */
export async function isLockedOut(db: Database, email: string, now = Date.now()): Promise<boolean> {
	const [row] = await db
		.select({ lockedUntil: loginAttempts.lockedUntil })
		.from(loginAttempts)
		.where(eq(loginAttempts.email, normalizeEmail(email)));
	return Boolean(row?.lockedUntil && row.lockedUntil.getTime() > now);
}

/**
 * Counts one failure for the address. The count starts over when the first failure of the
 * current series is older than the window; the fifth failure locks the address. Returns whether
 * the address is locked now.
 */
export async function recordFailedAttempt(
	db: Database,
	email: string,
	now = Date.now()
): Promise<{ failures: number; locked: boolean }> {
	email = normalizeEmail(email);
	const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email));
	const inWindow = row && now - row.firstFailureAt.getTime() <= LOCKOUT_WINDOW;
	const failures = inWindow ? row.failures + 1 : 1;
	const firstFailureAt = inWindow ? row.firstFailureAt : new Date(now);
	const stillLocked = row?.lockedUntil && row.lockedUntil.getTime() > now ? row.lockedUntil : null;
	const lockedUntil =
		failures >= MAX_FAILED_ATTEMPTS ? new Date(now + LOCKOUT_WINDOW) : stillLocked;
	await db
		.insert(loginAttempts)
		.values({ email, failures, firstFailureAt, lockedUntil })
		.onConflictDoUpdate({
			target: loginAttempts.email,
			set: { failures, firstFailureAt, lockedUntil }
		});
	return { failures, locked: lockedUntil !== null };
}

/** Forgets the failures of the address, after a successful sign-in or password reset. */
export async function clearFailedAttempts(db: Database, email: string): Promise<void> {
	await db.delete(loginAttempts).where(eq(loginAttempts.email, normalizeEmail(email)));
}

export type SignInResult =
	{ ok: true; userId: string } | { ok: false; reason: 'invalid' | 'locked' };

/**
 * The sign-in form: `authenticate` with the lockout around it. A locked address is refused
 * without checking the password; a wrong password counts; the right one clears the count.
 */
export async function signIn(db: Database, email: string, password: string): Promise<SignInResult> {
	if (await isLockedOut(db, email)) return { ok: false, reason: 'locked' };
	const userId = await authenticate(db, email, password);
	if (userId) {
		await clearFailedAttempts(db, email);
		return { ok: true, userId };
	}
	const { locked } = await recordFailedAttempt(db, email);
	return { ok: false, reason: locked ? 'locked' : 'invalid' };
}

// Link tokens (password resets, invitations): the token goes into the mail, its SHA-256 into
// the database, so a copy of the database cannot be used to take over an account.

/** A random token for a link, URL-safe. */
export function generateToken(): string {
	return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The SHA-256 of a token as lower-case hex, the form it is stored in. */
export async function hashToken(token: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Checks the current password of a signed-in user before a change. Wrong ones count like failed
 * sign-ins and a locked address is refused, so a stolen session cannot guess the password.
 */
export async function checkCurrentPassword(
	db: Database,
	user: { email: string; passwordHash: string },
	password: string
): Promise<'ok' | 'wrong-password' | 'locked'> {
	if (await isLockedOut(db, user.email)) return 'locked';
	if (await verifyPassword(password, user.passwordHash)) return 'ok';
	const { locked } = await recordFailedAttempt(db, user.email);
	return locked ? 'locked' : 'wrong-password';
}

/** The signed-in user with their password hash, looked up in their account. */
export async function signedInUser(db: Database, context: AuditContext) {
	if (!context.userId) return undefined;
	const [user] = await db
		.select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
		.from(users)
		.where(and(eq(users.id, context.userId), eq(users.accountId, context.accountId)));
	return user;
}

/**
 * checkCurrentPassword for the signed-in user, looked up in their account: the confirmation the
 * account deletion asks for. 'missing' when the user is not in the account.
 */
export async function confirmPassword(
	db: Database,
	context: AuditContext,
	password: string
): Promise<'ok' | 'wrong-password' | 'locked' | 'missing'> {
	const user = await signedInUser(db, context);
	if (!user) return 'missing';
	return checkCurrentPassword(db, user, password);
}

/** The condition for the sessions of the user except the one of `keepToken`, to delete them. */
export async function otherSessions(userId: string, keepToken: string | undefined) {
	const keepId = keepToken ? await sessionId(keepToken) : undefined;
	return keepId
		? and(eq(sessions.userId, userId), ne(sessions.id, keepId))
		: eq(sessions.userId, userId);
}

/**
 * Changes the password after checking the current one, ends every other session of the user
 * (the one in `keepToken` stays), revokes their API keys and drops a pending address change, which the notice to the old
 * address tells its owner to stop this way. The audit entry carries no user id and no address.
 */
export async function changePassword(
	db: Database,
	context: AuditContext,
	input: { currentPassword: string; password: string; keepToken: string | undefined }
): Promise<{ ok: true } | { ok: false; reason: 'wrong-password' | 'locked' | 'missing' }> {
	const user = await signedInUser(db, context);
	if (!user) return { ok: false, reason: 'missing' };
	const checked = await checkCurrentPassword(db, user, input.currentPassword);
	if (checked !== 'ok') return { ok: false, reason: checked };
	const passwordHash = await hashPassword(input.password);
	await runBatch(db, [
		db.update(users).set({ passwordHash }).where(eq(users.id, user.id)),
		db.delete(sessions).where(await otherSessions(user.id, input.keepToken)),
		db.delete(emailChanges).where(eq(emailChanges.userId, user.id)),
		db.delete(apiKeys).where(eq(apiKeys.userId, user.id)),
		auditEntry(
			db,
			{ accountId: context.accountId, userId: null },
			'user',
			user.id,
			'update',
			'Passwort geändert'
		)
	]);
	return { ok: true };
}

/** Sets the name of the signed-in user. A new address goes through requestEmailChange. */
export async function updateName(
	db: Database,
	context: AuditContext,
	name: string | null
): Promise<void> {
	if (!context.userId) return;
	const [user] = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.id, context.userId), eq(users.accountId, context.accountId)));
	if (!user) return;
	await runBatch(db, [
		db.update(users).set({ name }).where(eq(users.id, user.id)),
		auditEntry(db, context, 'user', user.id, 'update', 'Name geändert')
	]);
}
