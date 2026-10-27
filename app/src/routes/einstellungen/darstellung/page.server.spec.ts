import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database } from '#lib/server/db/index.ts';
import { users } from '#lib/server/db/schema.ts';
import { outcome, ownerA, routeEvent, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { load as loadProperties } from '../../objekte/+page.server';
import { actions, load } from './+page.server';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, options)));
}

describe('einstellungen/darstellung', () => {
	it('hides and shows the maps of the property list', async () => {
		await seedUnit(db, 'a');
		expect(await run(load)).toEqual({ data: { theme: 'system', showPropertyMaps: true } });
		expect(await run(loadProperties)).toMatchObject({
			data: { showMaps: true, properties: [{ position: [expect.any(Number), expect.any(Number)] }] }
		});

		expect(await run(actions.default, { form: {} })).toEqual({ data: { saved: true } });
		expect(await run(load)).toEqual({ data: { theme: 'system', showPropertyMaps: false } });
		expect(await run(loadProperties)).toMatchObject({
			data: { showMaps: false, properties: [{ position: null }] }
		});

		await run(actions.default, { form: { showPropertyMaps: 'on' } });
		expect(await run(load)).toEqual({ data: { theme: 'system', showPropertyMaps: true } });
	});

	it('saves the colour scheme and ignores unknown ones', async () => {
		await seedUnit(db, 'a');
		const theme = async () =>
			(await db.select({ theme: users.theme }).from(users).where(eq(users.id, ownerA.id)))[0]
				?.theme;
		expect(await theme()).toBe('system');

		await run(actions.default, { form: { theme: 'dark' } });
		expect(await theme()).toBe('dark');
		expect(await run(load, { theme: 'dark' })).toMatchObject({
			data: { theme: 'dark' }
		});

		await run(actions.default, { form: { theme: 'neon' } });
		expect(await theme()).toBe('dark');
		await run(actions.default, { form: { theme: 'light' } });
		expect(await theme()).toBe('light');
	});
});
