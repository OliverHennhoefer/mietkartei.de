import { count, eq } from 'drizzle-orm';
import type { Database } from './db';
import { accounts, sessions, users, type UserRole } from './db/schema';
import { DEFAULT_ACCOUNT_ID, ensureDefaultAccount } from './accounts';

// Sign-in uses only WebCrypto, which Node and Workers both provide, so both targets behave the same.

export const SESSION_COOKIE = 'session';

const DAY = 24 * 60 * 60 * 1000;
const SESSION_LIFETIME = 30 * DAY;
/** A session used within its last 15 days is extended, so active users stay signed in. */
const SESSION_RENEWAL = 15 * DAY;

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
		// Another registration won a race: either for the same address, or for the default account.
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
 * are extended, in which case `expiresAt` is set and the cookie must be renewed.
 */
export async function validateSession(
	db: Database,
	token: string
): Promise<{ user: SessionUser; expiresAt?: Date } | undefined> {
	const id = await sessionId(token);
	const [row] = await db
		.select({
			expiresAt: sessions.expiresAt,
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
	if (row.expiresAt.getTime() - now < SESSION_RENEWAL) {
		const expiresAt = new Date(now + SESSION_LIFETIME);
		await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
		return { user: row.user, expiresAt };
	}
	return { user: row.user };
}

export async function deleteSession(db: Database, token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.id, await sessionId(token)));
}
