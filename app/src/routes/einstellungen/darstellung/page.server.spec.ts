import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { outcome, routeEvent, seedUnit, testDatabase } from '#lib/server/testing.ts';
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
		expect(await run(load)).toEqual({ data: { showPropertyMaps: true } });
		expect(await run(loadProperties)).toMatchObject({
			data: { showMaps: true, properties: [{ position: [expect.any(Number), expect.any(Number)] }] }
		});

		expect(await run(actions.default, { form: {} })).toEqual({ data: { saved: true } });
		expect(await run(load)).toEqual({ data: { showPropertyMaps: false } });
		expect(await run(loadProperties)).toMatchObject({
			data: { showMaps: false, properties: [{ position: null }] }
		});

		await run(actions.default, { form: { showPropertyMaps: 'on' } });
		expect(await run(load)).toEqual({ data: { showPropertyMaps: true } });
	});
});
