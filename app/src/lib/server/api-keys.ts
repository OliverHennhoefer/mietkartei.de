import { and, asc, count, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { dayOf, formatDate } from '../dates';
import { auditEntry, type AuditContext } from './audit';
import { generateToken, hashToken, type SessionUser } from './auth';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { apiKeys, users, type ApiKeyScope } from './db/schema';

// API keys (Einstellungen → API-Schlüssel): a user creates a key for the API and the MCP server,
// and the key acts with that user's rights and no more. The key is shown once; the database
// holds only its SHA-256, so a copy of the database cannot be used to call the API. Keys always
// expire; a password change or reset revokes all keys of the user, removing the user removes
// them too.

const DAY = 24 * 60 * 60 * 1000;
/** The lifetimes the form offers, in days. */
export const API_KEY_LIFETIMES = [30, 90, 365] as const;
export const DEFAULT_API_KEY_LIFETIME = 90;
/** Keys a user may hold at once, expired ones included until they are cleaned up. */
export const MAX_API_KEYS_PER_USER = 10;
/** The last use is written at most this often, so a busy key does not write on every request. */
const LAST_USED_RESOLUTION = 60 * 60 * 1000;

/**
 * Every key starts with this, so secret scanners (GitHub's among them) can find a key that was
 * committed by mistake, and a key pasted in the wrong place is recognisable.
 */
export const API_KEY_PREFIX = 'mk_';
/** Characters of the key kept in plain text, to tell keys apart in the list. */
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 6;

export type ApiKeyInput = { name: string; scope: ApiKeyScope; lifetimeDays: number };

export type ApiKeySummary = {
	id: string;
	name: string;
	prefix: string;
	scope: ApiKeyScope;
	expiresAt: Date;
	lastUsedAt: Date | null;
	createdAt: Date;
};

/** The keys of the signed-in user, oldest first. Keys of other users stay invisible. */
export async function listApiKeys(db: Database, context: AuditContext): Promise<ApiKeySummary[]> {
	return listRows(db, context, false);
}

/** The apps the signed-in user connected by OAuth, oldest first; see #lib/server/oauth.ts. */
export async function listConnectedApps(
	db: Database,
	context: AuditContext
): Promise<ApiKeySummary[]> {
	return listRows(db, context, true);
}

async function listRows(
	db: Database,
	context: AuditContext,
	apps: boolean
): Promise<ApiKeySummary[]> {
	if (!context.userId) return [];
	return db
		.select({
			id: apiKeys.id,
			name: apiKeys.name,
			prefix: apiKeys.prefix,
			scope: apiKeys.scope,
			expiresAt: apiKeys.expiresAt,
			lastUsedAt: apiKeys.lastUsedAt,
			createdAt: apiKeys.createdAt
		})
		.from(apiKeys)
		.where(
			and(
				eq(apiKeys.accountId, context.accountId),
				eq(apiKeys.userId, context.userId),
				apps ? isNotNull(apiKeys.clientId) : isNull(apiKeys.clientId)
			)
		)
		.orderBy(asc(apiKeys.createdAt));
}

const scopeLabels: Record<ApiKeyScope, string> = { read: 'Lesen', write: 'Lesen und Schreiben' };

/**
 * Creates a key for the signed-in user and returns it; this is the only time it is readable.
 * Expired keys of the user are cleaned up first, so they do not count towards the limit.
 */
export async function createApiKey(
	db: Database,
	context: AuditContext,
	input: ApiKeyInput,
	now = Date.now()
): Promise<{ ok: true; id: string; key: string } | { ok: false; reason: 'limit' | 'missing' }> {
	const { userId, accountId } = context;
	if (!userId) return { ok: false, reason: 'missing' };
	await db
		.delete(apiKeys)
		.where(and(eq(apiKeys.userId, userId), lt(apiKeys.expiresAt, new Date(now))));
	const [{ value }] = await db
		.select({ value: count() })
		.from(apiKeys)
		.where(and(eq(apiKeys.userId, userId), isNull(apiKeys.clientId)));
	if (value >= MAX_API_KEYS_PER_USER) return { ok: false, reason: 'limit' };

	const key = `${API_KEY_PREFIX}${generateToken()}`;
	const id = await hashToken(key);
	const expiresAt = new Date(now + input.lifetimeDays * DAY);
	await runBatch(db, [
		db.insert(apiKeys).values({
			id,
			accountId,
			userId,
			name: input.name,
			prefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
			scope: input.scope,
			expiresAt
		}),
		auditEntry(
			db,
			context,
			'api_key',
			id,
			'create',
			`API-Schlüssel „${input.name}“ (${scopeLabels[input.scope]}, gültig bis ${formatDate(dayOf(expiresAt))}) angelegt`
		)
	]);
	return { ok: true, id, key };
}

/** Revokes a key or app connection of the signed-in user. False when the user holds no such key. */
export async function revokeApiKey(
	db: Database,
	context: AuditContext,
	keyId: string
): Promise<boolean> {
	if (!context.userId) return false;
	const where = and(
		eq(apiKeys.id, keyId),
		eq(apiKeys.accountId, context.accountId),
		eq(apiKeys.userId, context.userId)
	);
	const [key] = await db
		.select({ name: apiKeys.name, clientId: apiKeys.clientId })
		.from(apiKeys)
		.where(where);
	if (!key) return false;
	const summary = key.clientId
		? `Verbindung mit „${key.name}“ getrennt`
		: `API-Schlüssel „${key.name}“ widerrufen`;
	await runBatch(db, [
		db.delete(apiKeys).where(where),
		auditEntry(db, context, 'api_key', keyId, 'delete', summary)
	]);
	return true;
}

/** The statement that revokes every key of a user, to run in the batch of a password change. */
export function revokeAllApiKeys(db: Database, userId: string) {
	return db.delete(apiKeys).where(eq(apiKeys.userId, userId));
}

export type ApiCaller = { user: SessionUser; scope: ApiKeyScope; keyId: string };

/**
 * The user behind a key, with the key's scope. Unknown and expired keys give undefined; an
 * expired one is deleted on the way. The last use is recorded at most once an hour.
 */
export async function authenticateApiKey(
	db: Database,
	key: string,
	now = Date.now()
): Promise<ApiCaller | undefined> {
	if (!key.startsWith(API_KEY_PREFIX)) return undefined;
	const id = await hashToken(key);
	const [row] = await db
		.select({
			scope: apiKeys.scope,
			expiresAt: apiKeys.expiresAt,
			accessExpiresAt: apiKeys.accessExpiresAt,
			lastUsedAt: apiKeys.lastUsedAt,
			user: {
				id: users.id,
				email: users.email,
				accountId: users.accountId,
				name: users.name,
				role: users.role
			}
		})
		.from(apiKeys)
		.innerJoin(users, eq(apiKeys.userId, users.id))
		.where(eq(apiKeys.id, id));
	if (!row) return undefined;
	if (row.expiresAt.getTime() <= now) {
		await db.delete(apiKeys).where(eq(apiKeys.id, id));
		return undefined;
	}
	// An app's access token runs out long before its refresh token, which keeps the row.
	if (row.accessExpiresAt && row.accessExpiresAt.getTime() <= now) return undefined;
	if (!row.lastUsedAt || now - row.lastUsedAt.getTime() >= LAST_USED_RESOLUTION) {
		await db
			.update(apiKeys)
			.set({ lastUsedAt: new Date(now) })
			.where(eq(apiKeys.id, id));
	}
	// A viewer only reads, whatever the key says.
	const scope = row.user.role === 'viewer' ? 'read' : row.scope;
	return { user: row.user, scope, keyId: id };
}
