import { and, eq, inArray } from 'drizzle-orm';
import type { SessionUser } from './auth';
import type { Database } from './db';
import { chunk, chunkIds, rowsPerStatement, runBatch, selectInChunks } from './db/batch';
import { dismissedHints } from './db/schema';

// Hinweise a user closes with their x: the checks of a Nebenkostenabrechnung, a Hausgeldabrechnung
// or a Steuerübersicht that are worth a look but not wrong as such. Closing one only hides it for
// that user. A Hinweis is known by where it stands and its text, so it shows again once its text
// changes, e.g. with another amount. Hinweise that block an approval cannot be closed.

/** Keys one post may close or show again; a page has far fewer Hinweise. */
export const MAX_HINT_KEYS = 50;

const KEY = /^[0-9a-f]{64}$/;

/** A Hinweis as the pages get it: with its key and whether the user closed it. */
export type Hint<T> = T & { key: string; dismissed: boolean };

/** Whether a posted key has the form of one: the hex SHA-256 of hintKey. */
export function isHintKey(value: unknown): value is string {
	return typeof value === 'string' && KEY.test(value);
}

/** The key of a Hinweis: the SHA-256 of its place (e.g. "steuer:<property>:2025") and text. */
export async function hintKey(scope: string, message: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(`${scope}\n${message}`)
	);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Where the Hinweise of a Nebenkostenabrechnung stand: one year of a property, all versions. */
export function statementHintScope(propertyId: string, periodStart: string): string {
	return `abrechnung:${propertyId}:${periodStart}`;
}

/**
 * The Hinweise of one place with their keys, marked as the user closed them. A text that comes
 * twice is shown once.
 */
export async function withDismissals<T extends { message: string; blocking?: boolean }>(
	db: Database,
	userId: string,
	scope: string,
	hints: readonly T[]
): Promise<Hint<T>[]> {
	const byMessage = new Map<string, T>();
	for (const hint of hints) {
		const known = byMessage.get(hint.message);
		if (!known || (hint.blocking && !known.blocking)) byMessage.set(hint.message, hint);
	}
	const keyed = await Promise.all(
		[...byMessage.values()].map(async (hint) => ({
			...hint,
			key: await hintKey(scope, hint.message)
		}))
	);
	const closable = keyed.filter((hint) => !hint.blocking).map((hint) => hint.key);
	const rows = await selectInChunks(closable, (keys) =>
		db
			.select({ key: dismissedHints.key })
			.from(dismissedHints)
			.where(and(eq(dismissedHints.userId, userId), inArray(dismissedHints.key, keys)))
	);
	const closed = new Set(rows.map((row) => row.key));
	return keyed.map((hint) => ({ ...hint, dismissed: !hint.blocking && closed.has(hint.key) }));
}

/** Closes Hinweise for the user; closing one twice changes nothing. */
export async function dismissHints(
	db: Database,
	user: Pick<SessionUser, 'id' | 'accountId'>,
	keys: string[]
): Promise<void> {
	const rows = keys.map((key) => ({ accountId: user.accountId, userId: user.id, key }));
	await runBatch(
		db,
		chunk(rows, rowsPerStatement(dismissedHints)).map((group) =>
			db.insert(dismissedHints).values(group).onConflictDoNothing()
		)
	);
}

/** Shows closed Hinweise again for the user. */
export async function restoreHints(db: Database, userId: string, keys: string[]): Promise<void> {
	await runBatch(
		db,
		chunkIds(keys).map((group) =>
			db
				.delete(dismissedHints)
				.where(and(eq(dismissedHints.userId, userId), inArray(dismissedHints.key, group)))
		)
	);
}
