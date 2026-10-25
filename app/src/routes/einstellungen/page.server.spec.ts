import { gzipSync, strFromU8, strToU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { auditEntry } from '#lib/server/audit.ts';
import { consumerPriceIndex } from '#lib/server/db/schema.ts';
import { storeDocument } from '#lib/server/documents.ts';
import {
	managerA,
	memoryStorage,
	outcome,
	routeEvent,
	seedTenant,
	testDatabase
} from '#lib/server/testing.ts';
import { GET as download } from './export/herunterladen/+server';
import { POST as restore } from './export/einspielen/+server';
import { PUT as restoreFile } from './export/einspielen/[id]/+server';
import { load as loadExport } from './export/+page.server';
import { load as loadLog } from './protokoll/+page.server';
import { load as loadSettings } from './+page.server';
import { load as loadVpi } from './vpi/+page.server';

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

describe('einstellungen', () => {
	it('opens on the profile', async () => {
		expect(await run(loadSettings)).toEqual({ redirect: '/einstellungen/profil' });
	});
});

describe('vpi', () => {
	it('shows the shared values and that nothing is fetched without a token', async () => {
		await db.insert(consumerPriceIndex).values([
			{ month: '2025-01', value: 121, baseYear: '2020' },
			{ month: '2026-01', value: 124.3, baseYear: '2020' }
		]);
		expect(await run(loadVpi)).toEqual({
			data: {
				values: [
					{ month: '2026-01', value: 124.3 },
					{ month: '2025-01', value: 121 }
				],
				configured: false,
				running: false,
				lastFetch: null
			}
		});
	});
});

describe('protokoll', () => {
	it('lists the log, narrowed to one entity on request', async () => {
		await seedTenant(db, 'a');
		await auditEntry(
			db,
			{ accountId: 'a', userId: null },
			'task',
			't',
			'create',
			'Aufgabe angelegt'
		);
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
		expect(await run(restore, { user: managerA })).toMatchObject({ error: 403 });
		expect(await run(restoreFile, { user: managerA })).toMatchObject({ error: 403 });
		expect(await run(loadExport)).toEqual({ data: { canRestore: true } });
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

	it('restores an export into an empty account, then its documents one by one', async () => {
		const tenantId = await seedTenant(db, 'a', { lastName: 'Umgezogen' });
		await storeDocument(
			db,
			{ accountId: 'a', userId: 'user-a' },
			{
				name: 'Vertrag.pdf',
				mimeType: 'application/pdf',
				bytes: new Uint8Array([7, 8]),
				links: { tenantId }
			}
		);
		const files = unzipSync(
			new Uint8Array(await ((await run(download)) as { data: Response }).data.arrayBuffer())
		);
		const [path] = Object.keys(files).filter(
			(name) => name.startsWith('documents/') && !name.endsWith('/')
		);
		const documentId = path.slice('documents/'.length, 'documents/'.length + 36);

		// A new instance: the same export into an empty database.
		db = await testDatabase();
		storage.current = memoryStorage();
		const post = (body: BodyInit, origin = 'http://localhost') =>
			run((event: { request: Request }) =>
				restore({
					...(event as object),
					request: new Request('http://localhost/einstellungen/export/einspielen', {
						method: 'POST',
						headers: { origin, 'content-type': 'application/gzip' },
						body
					})
				} as never)
			);
		const gzipped = gzipSync(files['export.json']);
		expect(await post(gzipped, 'https://fremd.example')).toMatchObject({ error: 403 });
		expect(await post(gzipSync(strToU8('{"format":"anders"}')))).toMatchObject({ error: 400 });
		expect(await post(strToU8('kein gzip'))).toMatchObject({ error: 400 });

		const restored = (await post(gzipped)) as { data: Response };
		expect(await restored.data.json()).toMatchObject({ documents: 1 });
		expect(await run(loadExport)).toEqual({ data: { canRestore: false } });
		expect(await post(gzipped)).toMatchObject({ error: 409 });

		const put = (bytes: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) =>
			run((event: { request: Request }) =>
				restoreFile({
					...(event as object),
					params: { id: documentId },
					request: new Request(`http://localhost/einstellungen/export/einspielen/${documentId}`, {
						method: 'PUT',
						headers: { origin: 'http://localhost', ...headers },
						body: bytes
					})
				} as never)
			);
		expect(
			await put(new Uint8Array(files[path]), { origin: 'https://fremd.example' })
		).toMatchObject({ error: 403 });
		expect(
			await put(new Uint8Array(files[path]), { 'content-length': String(11 * 1024 * 1024) })
		).toMatchObject({ error: 413 });
		expect(await put(new Uint8Array([7]))).toMatchObject({ error: 400 });
		expect(await put(new Uint8Array(files[path]))).toMatchObject({
			data: expect.objectContaining({ status: 204 })
		});
		expect(await put(new Uint8Array(files[path]))).toMatchObject({ error: 409 });
		const again = unzipSync(
			new Uint8Array(await ((await run(download)) as { data: Response }).data.arrayBuffer())
		);
		expect(strFromU8(again['export.json'])).toContain('Umgezogen');
		expect(again[path]).toEqual(new Uint8Array([7, 8]));
	});
});
