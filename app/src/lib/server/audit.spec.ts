import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditEntry, listAuditEntities, listAuditLog } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { users } from './db/schema';
import { contextA, contextB, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	await db.update(users).set({ name: 'Vera Vermieterin' }).where(eq(users.id, 'user-a'));
	// Written in one batch, so most share the millisecond; the insert order decides.
	await runBatch(db, [
		auditEntry(db, contextA, 'property', 'p1', 'create', 'Objekt Lindenstraße 4 angelegt'),
		auditEntry(db, contextB, 'property', 'p2', 'create', 'Objekt im fremden Konto angelegt'),
		auditEntry(db, contextA, 'unit', 'u1', 'create', 'Einheit EG links angelegt'),
		auditEntry(
			db,
			{ accountId: 'a', userId: null },
			'user',
			'user-a',
			'reset',
			'Passwort über einen Link zurückgesetzt'
		)
	]);
});

describe('listAuditLog', () => {
	it('lists the entries of the account only, newest first, with who wrote them', async () => {
		const entries = await listAuditLog(db, 'a');
		expect(entries.map((entry) => [entry.summary, entry.userName, entry.userEmail])).toEqual([
			['Passwort über einen Link zurückgesetzt', null, null],
			['Einheit EG links angelegt', 'Vera Vermieterin', 'a@example.org'],
			['Objekt Lindenstraße 4 angelegt', 'Vera Vermieterin', 'a@example.org']
		]);
		expect(await listAuditLog(db, 'a', { limit: 1 })).toHaveLength(1);
	});
});

describe('listAuditLog by entity and listAuditEntities', () => {
	it('narrow the log to one entity and list the entities of the account', async () => {
		const properties = await listAuditLog(db, 'a', { entity: 'property' });
		expect(properties.map((entry) => entry.entityId)).toEqual(['p1']);
		expect(await listAuditLog(db, 'a', { entity: 'nope' })).toEqual([]);
		expect(await listAuditEntities(db, 'a')).toEqual(['property', 'unit', 'user']);
		expect(await listAuditEntities(db, 'b')).toEqual(['property']);
	});
});
