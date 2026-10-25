import { beforeEach, describe, expect, it } from 'vitest';
import { authenticateApiKey, listApiKeys } from '#lib/server/api-keys.ts';
import type { Database } from '#lib/server/db/index.ts';
import { users } from '#lib/server/db/schema.ts';
import { contextA, managerA, outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

const create = (form: Record<string, string>, user = undefined as typeof managerA | undefined) =>
	outcome(() => actions.create(routeEvent(db, { form, user })));

describe('api-schluessel', () => {
	it('creates a key, shows it once and lists it without the key', async () => {
		const result = await create({ name: 'Claude', lifetimeDays: '90' });
		const { key } = (result as { data: { created: { key: string } } }).data.created;
		expect(result).toEqual({ data: { created: { name: 'Claude', key } } });
		expect(await authenticateApiKey(db, key)).toMatchObject({
			scope: 'read',
			user: { id: 'user-a' }
		});

		const loaded = (await outcome(() => load(routeEvent(db)))) as {
			data: { keys: { name: string }[]; scopes: string[]; origin: string };
		};
		expect(loaded.data.keys).toMatchObject([{ name: 'Claude' }]);
		expect(JSON.stringify(loaded.data)).not.toContain(key);
		expect(loaded.data.scopes).toEqual(['read', 'write']);
		expect(loaded.data.origin).toBe('http://localhost');
	});

	it('creates a key that may write when asked to', async () => {
		const result = await create({ name: 'Skript', scope: 'write', lifetimeDays: '30' });
		const { key } = (result as { data: { created: { key: string } } }).data.created;
		expect(await authenticateApiKey(db, key)).toMatchObject({ scope: 'write' });
	});

	it('refuses an eleventh key', async () => {
		for (let index = 1; index <= 10; index++) {
			await create({ name: `Schlüssel ${index}`, lifetimeDays: '30' });
		}
		expect(await create({ name: 'Noch einer', lifetimeDays: '30' })).toEqual({
			fail: 400,
			data: {
				refused: 'Du hast schon 10 API-Schlüssel. Widerrufe einen, um einen neuen anzulegen.'
			}
		});
	});

	it('checks the form', async () => {
		expect(await create({ name: '', scope: 'admin', lifetimeDays: '7' })).toMatchObject({
			fail: 400,
			data: {
				errors: {
					name: expect.any(String),
					scope: expect.any(String),
					lifetimeDays: expect.any(String)
				}
			}
		});
	});

	it('lets managers manage their own keys', async () => {
		await db.insert(users).values({
			id: 'manager-a',
			accountId: 'a',
			email: 'm@example.org',
			passwordHash: 'x',
			role: 'manager'
		});
		expect(await create({ name: 'Skript', lifetimeDays: '30' }, managerA)).toMatchObject({
			data: { created: { name: 'Skript' } }
		});
		expect(await listApiKeys(db, contextA)).toEqual([]);
	});

	it('revokes a key of the user', async () => {
		await create({ name: 'Claude', lifetimeDays: '30' });
		const [key] = await listApiKeys(db, contextA);
		const revoke = (keyId: string) =>
			outcome(() => actions.revoke(routeEvent(db, { form: { keyId } })));
		expect(await revoke(key.id)).toEqual({ data: { revoked: true } });
		expect(await revoke(key.id)).toMatchObject({ fail: 404 });
		expect(await listApiKeys(db, contextA)).toEqual([]);
	});
});
