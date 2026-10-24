import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	API_KEY_PREFIX,
	authenticateApiKey,
	createApiKey,
	listApiKeys,
	MAX_API_KEYS_PER_USER,
	revokeApiKey
} from './api-keys';
import { listAuditLog } from './audit';
import { changePassword, hashToken } from './auth';
import type { Database } from './db';
import { apiKeys, users } from './db/schema';
import { removeUser } from './invitations';
import { requestPasswordReset, resetPassword } from './password-resets';
import { contextA, contextB, PASSWORD, setPassword, testDatabase } from './testing';

const DAY = 24 * 60 * 60 * 1000;
const input = { name: 'Claude', scope: 'read' as const, lifetimeDays: 90 };

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

async function create(context = contextA, now = Date.now()) {
	const created = await createApiKey(db, context, input, now);
	if (!created.ok) throw new Error(created.reason);
	return created;
}

describe('createApiKey', () => {
	it('returns the key once and stores only its hash and prefix', async () => {
		const { id, key } = await create();
		expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
		expect(key.length).toBeGreaterThan(40);
		const [row] = await db.select().from(apiKeys);
		expect(row.id).toBe(id);
		expect(row.id).toBe(await hashToken(key));
		expect(JSON.stringify(row)).not.toContain(key);
		expect(key.startsWith(row.prefix)).toBe(true);
		expect(row.prefix.length).toBeLessThan(12);
		const [entry] = await listAuditLog(db, 'a');
		expect(entry).toMatchObject({ entity: 'api_key', action: 'create' });
		expect(entry.summary).toContain('„Claude“ (Lesen, gültig bis');
		expect(entry.summary).not.toContain(key);
	});

	it('expires after the chosen days', async () => {
		const now = Date.UTC(2026, 0, 1);
		await create(contextA, now);
		const [row] = await db.select().from(apiKeys);
		expect(row.expiresAt.getTime()).toBe(now + 90 * DAY);
	});

	it('limits the keys per user, not counting expired ones', async () => {
		const now = Date.now();
		await create(contextA, now - 100 * DAY);
		for (let i = 1; i < MAX_API_KEYS_PER_USER; i++) await create(contextA, now);
		// The old key has expired by now and is cleaned up, so the tenth fits.
		await create(contextA, now);
		expect(await createApiKey(db, contextA, input, now)).toEqual({ ok: false, reason: 'limit' });
		expect((await create(contextB, now)).key).toBeTruthy();
	});

	it('needs a user', async () => {
		expect(await createApiKey(db, { accountId: 'a', userId: null }, input)).toEqual({
			ok: false,
			reason: 'missing'
		});
	});
});

describe('listApiKeys', () => {
	it('shows only the keys of the signed-in user, without the key', async () => {
		await create(contextA);
		await create(contextB);
		const keys = await listApiKeys(db, contextA);
		expect(keys).toHaveLength(1);
		expect(keys[0]).toMatchObject({ name: 'Claude', scope: 'read', lastUsedAt: null });
		expect(Object.keys(keys[0])).not.toContain('userId');
	});
});

describe('authenticateApiKey', () => {
	it('returns the user and scope behind a valid key', async () => {
		const { key, id } = await create();
		expect(await authenticateApiKey(db, key)).toEqual({
			user: { id: 'user-a', email: 'a@example.org', accountId: 'a', name: null, role: 'owner' },
			scope: 'read',
			keyId: id
		});
	});

	it('refuses unknown, malformed and expired keys and deletes the expired one', async () => {
		const now = Date.now();
		const { key } = await create(contextA, now);
		expect(await authenticateApiKey(db, `${key}x`, now)).toBeUndefined();
		expect(await authenticateApiKey(db, key.slice(API_KEY_PREFIX.length), now)).toBeUndefined();
		expect(await authenticateApiKey(db, key, now + 90 * DAY)).toBeUndefined();
		expect(await db.select().from(apiKeys)).toEqual([]);
	});

	it('records the last use at most once an hour', async () => {
		const now = Date.now();
		const { key } = await create(contextA, now);
		await authenticateApiKey(db, key, now);
		await authenticateApiKey(db, key, now + 30 * 60 * 1000);
		let [row] = await db.select().from(apiKeys);
		expect(row.lastUsedAt?.getTime()).toBe(now);
		await authenticateApiKey(db, key, now + 61 * 60 * 1000);
		[row] = await db.select().from(apiKeys);
		expect(row.lastUsedAt?.getTime()).toBe(now + 61 * 60 * 1000);
	});
});

describe('revoking', () => {
	it('revokes a key of the user and no one else', async () => {
		const { key, id } = await create(contextA);
		expect(await revokeApiKey(db, contextB, id)).toBe(false);
		expect(await revokeApiKey(db, { ...contextA, userId: 'manager-a' }, id)).toBe(false);
		expect(await authenticateApiKey(db, key)).toBeDefined();
		expect(await revokeApiKey(db, contextA, id)).toBe(true);
		expect(await authenticateApiKey(db, key)).toBeUndefined();
		const [entry] = await listAuditLog(db, 'a');
		expect(entry).toMatchObject({ action: 'delete', summary: 'API-Schlüssel „Claude“ widerrufen' });
	});

	it('revokes every key of a user who changes the password', async () => {
		await setPassword(db, 'user-a');
		const { key } = await create(contextA);
		const other = await create(contextB);
		const result = await changePassword(db, contextA, {
			currentPassword: PASSWORD,
			password: 'ein-neues-passwort-42',
			keepToken: undefined
		});
		expect(result).toEqual({ ok: true });
		expect(await authenticateApiKey(db, key)).toBeUndefined();
		expect(await authenticateApiKey(db, other.key)).toBeDefined();
	});

	it('revokes every key of a user who resets the password', async () => {
		const { key } = await create(contextA);
		const reset = await requestPasswordReset(db, 'a@example.org');
		expect(await resetPassword(db, reset!.token, 'ein-neues-passwort-42')).toMatchObject({
			ok: true
		});
		expect(await authenticateApiKey(db, key)).toBeUndefined();
	});

	it('revokes the keys of a removed manager', async () => {
		await db.insert(users).values({
			id: 'manager-a',
			accountId: 'a',
			email: 'm@example.org',
			passwordHash: 'x',
			role: 'manager'
		});
		const { key } = await create({ accountId: 'a', userId: 'manager-a' });
		expect(await removeUser(db, contextA, 'manager-a')).toBe('removed');
		expect(await authenticateApiKey(db, key)).toBeUndefined();
		expect(await db.select().from(apiKeys).where(eq(apiKeys.userId, 'manager-a'))).toEqual([]);
	});
});
