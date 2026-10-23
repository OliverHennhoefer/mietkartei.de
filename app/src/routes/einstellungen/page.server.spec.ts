import { unzipSync, strFromU8 } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { listIndexValues } from '#lib/server/rent-adjustments.ts';
import {
	managerA,
	memoryStorage,
	outcome,
	routeEvent,
	seedTenant,
	testDatabase
} from '#lib/server/testing.ts';
import { GET as download } from './export/herunterladen/+server';
import { load as loadExport } from './export/+page.server';
import { load as loadLog } from './protokoll/+page.server';
import { actions as vpiActions, load as loadVpi } from './vpi/+page.server';

// The smaller settings pages: VPI values, the audit log and the data export.

const storage = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('#lib/server/storage/index.ts', async (original) => ({
	...(await original<typeof import('#lib/server/storage/index.ts')>()),
	getStorage: async () => storage.current
}));

let db: Database;

beforeEach(async () => {
	storage.current = memoryStorage();
	db = await testDatabase();
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, options)));
}

describe('vpi', () => {
	it('adds a value once per month and deletes it', async () => {
		const form = { month: '2026-01', value: '124,3', baseYear: '2020' };
		expect(await run(vpiActions.add, { form })).toEqual({ data: { added: '2026-01' } });
		expect(await run(vpiActions.add, { form })).toMatchObject({
			fail: 400,
			data: { refusal: expect.any(String), values: { value: '124,3' } }
		});
		expect(await run(vpiActions.add, { form: { ...form, value: '' } })).toMatchObject({
			fail: 400
		});
		expect(await run(loadVpi)).toMatchObject({ data: { values: [{ month: '2026-01' }] } });
		const [value] = await listIndexValues(db, 'a');
		expect(await run(vpiActions.delete, { form: {} })).toMatchObject({ error: 404 });
		expect(await run(vpiActions.delete, { form: { id: value.id } })).toEqual({
			data: { deleted: true }
		});
		expect(await run(vpiActions.delete, { form: { id: value.id } })).toMatchObject({ error: 404 });
	});
});

describe('protokoll', () => {
	it('lists the log, narrowed to one entity on request', async () => {
		await seedTenant(db, 'a');
		await run(vpiActions.add, { form: { month: '2026-01', value: '124,3', baseYear: '2020' } });
		const all = (await run(loadLog, { url: '/x' })) as {
			data: { entries: { entity: string }[]; entities: string[] };
		};
		expect(all.data.entities.length).toBeGreaterThan(0);
		const [entity] = all.data.entities;
		const narrowed = (await run(loadLog, { url: `/x?entity=${entity}` })) as {
			data: { entries: { entity: string }[]; entity: string };
		};
		expect(narrowed.data.entity).toBe(entity);
		expect(narrowed.data.entries.every((entry) => entry.entity === entity)).toBe(true);
		expect(await run(loadLog, { url: `/x?entity=${'x'.repeat(51)}` })).toMatchObject({
			data: { entity: '' }
		});
	});
});

describe('export', () => {
	it('is for owners only', async () => {
		expect(await run(loadExport, { user: managerA })).toMatchObject({ error: 403 });
		expect(await run(download, { user: managerA })).toMatchObject({ error: 403 });
		expect(await run(loadExport)).toEqual({ data: {} });
	});

	it('downloads the account as a ZIP with export.json', async () => {
		await seedTenant(db, 'a', { lastName: 'Exportiert' });
		await seedTenant(db, 'b', { lastName: 'Fremd' });
		const response = (await run(download)) as { data: Response };
		expect(response.data.headers.get('content-type')).toBe('application/zip');
		expect(response.data.headers.get('content-disposition')).toMatch(
			/^attachment; filename="mietkartei-export-\d{4}-\d{2}-\d{2}\.zip"$/
		);
		const files = unzipSync(new Uint8Array(await response.data.arrayBuffer()));
		const json = strFromU8(files['export.json']);
		expect(json).toContain('Exportiert');
		expect(json).not.toContain('Fremd');
	});
});
