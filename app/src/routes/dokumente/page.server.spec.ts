import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { storeDocument } from '#lib/server/documents.ts';
import { getLease } from '#lib/server/leases.ts';
import {
	contextB,
	memoryStorage,
	outcome,
	ownerA,
	routeEvent,
	seedLease,
	seedTenant,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import {
	actions as leaseActions,
	load as loadLeaseDocuments
} from '../vertraege/[id]/dokumente/+page.server';
import { GET as download } from './[id]/herunterladen/+server';
import { actions, load } from './+page.server';

// /dokumente, the download, and the lease's Dokumente tab, which share helpers.server.ts.

const storage = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('#lib/server/storage/index.ts', async (original) => ({
	...(await original<typeof import('#lib/server/storage/index.ts')>()),
	getStorage: async () => storage.current
}));

let db: Database;
let propertyId: string;
let leaseId: string;

beforeEach(async () => {
	storage.current = memoryStorage();
	db = await testDatabase();
	const seeded = await seedUnit(db, 'a');
	propertyId = seeded.propertyId;
	leaseId = await seedLease(db, 'a', seeded.unitId);
});

const pdf = (name = 'Mietvertrag.pdf') =>
	new File(['%PDF-1.4 Vertrag'], name, { type: 'application/pdf' });

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, options)));
}

type Page = { data: { documents: { id: string; name: string; leaseId: string | null }[] } };

async function documents(url = '/dokumente') {
	return ((await run(load, { url })) as Page).data.documents;
}

describe('dokumente', () => {
	it('uploads a document with its links and filters by them', async () => {
		expect(
			await run(actions.upload, { form: { file: pdf(), name: 'Vertrag EG', propertyId } })
		).toEqual({ data: { uploaded: 'Vertrag EG.pdf' } });
		await run(actions.upload, { form: { file: pdf('Sonstiges.pdf') } });
		expect(await documents()).toHaveLength(2);
		expect(await run(load, { url: `/dokumente?propertyId=${propertyId}` })).toMatchObject({
			data: { documents: [{ name: 'Vertrag EG.pdf' }], filtered: true }
		});
	});

	it('refuses links of another account on their field, and empty files', async () => {
		const foreignTenant = await seedTenant(db, 'b');
		expect(
			await run(actions.upload, { form: { file: pdf(), tenantId: foreignTenant } })
		).toMatchObject({ fail: 400, data: { errors: { tenantId: expect.any(String) } } });
		expect(await run(actions.upload, { form: { file: new File([''], 'leer.pdf') } })).toMatchObject(
			{ fail: 400, data: { errors: { file: 'Die Datei ist leer.' } } }
		);
		expect(await documents()).toEqual([]);
	});

	it('downloads a document, inline only when asked and safe', async () => {
		await run(actions.upload, { form: { file: pdf() } });
		const [document] = await documents();
		const saved = (await run(download, { params: { id: document.id } })) as { data: Response };
		expect(saved.data.headers.get('Content-Disposition')).toMatch(/^attachment/);
		expect(saved.data.headers.get('Content-Security-Policy')).toContain('sandbox');
		expect(await saved.data.text()).toBe('%PDF-1.4 Vertrag');
		const shown = (await run(download, {
			params: { id: document.id },
			url: '/x?inline=1'
		})) as { data: Response };
		expect(shown.data.headers.get('Content-Disposition')).toMatch(/^inline/);
		expect(shown.data.headers.get('Content-Security-Policy')).toBeNull();
	});

	it('serves an HTML file only as a sandboxed download', async () => {
		await run(actions.upload, {
			form: { file: new File(['<script>alert(1)</script>'], 'x.html', { type: 'text/html' }) }
		});
		const [document] = await documents();
		const response = (await run(download, {
			params: { id: document.id },
			url: '/x?inline=1'
		})) as { data: Response };
		expect(response.data.headers.get('Content-Disposition')).toMatch(/^attachment/);
		expect(response.data.headers.get('Content-Security-Policy')).toContain('sandbox');
		expect(response.data.headers.get('X-Content-Type-Options')).toBe('nosniff');
	});

	it('deletes a document once and answers 404 for another account’s', async () => {
		await run(actions.upload, { form: { file: pdf() } });
		const [document] = await documents();
		expect(await run(actions.delete, { form: {} })).toMatchObject({ error: 400 });
		expect(await run(actions.delete, { form: { documentId: document.id } })).toEqual({
			redirect: '/dokumente'
		});
		expect(await run(actions.delete, { form: { documentId: document.id } })).toMatchObject({
			error: 404
		});
		expect(await run(download, { params: { id: document.id } })).toMatchObject({ error: 404 });

		const foreign = await storeDocument(db, contextB, {
			name: 'Fremd.pdf',
			mimeType: 'application/pdf',
			bytes: new TextEncoder().encode('%PDF-1.4 fremd')
		});
		if (!foreign.ok) throw new Error('setup failed');
		const ownerB = { ...ownerA, id: 'user-b', accountId: 'b', email: 'b@example.org' };
		expect(await run(actions.delete, { form: { documentId: foreign.id } })).toMatchObject({
			error: 404
		});
		expect(await run(download, { params: { id: foreign.id } })).toMatchObject({ error: 404 });
		// Still there for its own account.
		expect(await run(download, { params: { id: foreign.id }, user: ownerB })).toMatchObject({
			data: expect.any(Response)
		});
	});
});

describe('vertraege/[id]/dokumente', () => {
	it('links an upload to the lease and its property, whatever the form says', async () => {
		const other = await seedUnit(db, 'a', { propertyName: 'Zweites' });
		expect(
			await run(leaseActions.upload, {
				params: { id: leaseId },
				form: { file: pdf(), propertyId: other.propertyId }
			})
		).toEqual({ data: { uploaded: 'Mietvertrag.pdf' } });
		const parent = { lease: await getLease(db, 'a', leaseId) };
		expect(await run(loadLeaseDocuments, { params: { id: leaseId }, parent })).toMatchObject({
			data: { documents: [{ leaseId, propertyId }] }
		});
		const [document] = await documents();
		expect(
			await run(leaseActions.delete, { params: { id: leaseId }, form: { documentId: document.id } })
		).toEqual({ redirect: `/vertraege/${leaseId}/dokumente` });
	});

	it('answers 404 for a lease of another account', async () => {
		const foreign = await seedUnit(db, 'b');
		const foreignLease = await seedLease(db, 'b', foreign.unitId);
		expect(
			await run(leaseActions.upload, { params: { id: foreignLease }, form: { file: pdf() } })
		).toMatchObject({ error: 404 });
	});
});
