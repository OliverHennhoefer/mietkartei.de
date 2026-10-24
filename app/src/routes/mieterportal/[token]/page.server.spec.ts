import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { damageReports, documents, outbox } from '#lib/server/db/schema.ts';
import { createPortalLink } from '#lib/server/portal.ts';
import {
	contextA,
	memoryStorage,
	outcome,
	routeEvent,
	seedLease,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const env = vi.hoisted(() => ({ ORIGIN: '', MAIL_TRANSPORT: 'outbox' }));
vi.mock('$app/env/private', () => env);

const storage = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('#lib/server/storage/index.ts', async (original) => ({
	...(await original<typeof import('#lib/server/storage/index.ts')>()),
	getStorage: async () => storage.current
}));

let db: Database;
let token: string;
let leaseId: string;

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeEach(async () => {
	db = await testDatabase();
	storage.current = memoryStorage();
	const { unitId } = await seedUnit(db, 'a', { name: 'EG links', propertyName: 'Haus' });
	leaseId = await seedLease(db, 'a', unitId);
	token = (await createPortalLink(db, contextA, leaseId))!;
});

// Tenants have no session: every call here is a visitor's.
function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, { user: null, params: { token }, ...options })));
}

const report = { title: 'Heizung kalt', description: 'Seit gestern.', urgent: 'on' };

describe('mieterportal', () => {
	it('shows the unit and no reports to a visitor with the link', async () => {
		expect(await run(load)).toEqual({
			data: {
				unitName: 'EG links',
				propertyName: 'Haus',
				address: 'Lindenstraße 4, 10115 Berlin',
				landlord: 'Konto A',
				reports: []
			}
		});
	});

	it('answers 404 for an unknown or replaced link', async () => {
		expect(await run(load, { params: { token: 'x'.repeat(43) } })).toMatchObject({ error: 404 });
		const old = token;
		await createPortalLink(db, contextA, leaseId);
		expect(await run(load, { params: { token: old } })).toMatchObject({ error: 404 });
		expect(await run(actions.default, { params: { token: old }, form: report })).toMatchObject({
			error: 404
		});
	});

	it('stores a report with a photo, mails the users and lists it', async () => {
		const photo = new File([png], 'heizung.png', { type: 'image/png' });
		expect(await run(actions.default, { form: { ...report, photos: photo } })).toEqual({
			data: { sent: 'Heizung kalt', photos: 1, photosSent: 1 }
		});
		const [row] = await db.select().from(damageReports);
		expect(row).toMatchObject({ accountId: 'a', title: 'Heizung kalt', urgent: true });
		expect(await db.select().from(documents)).toMatchObject([{ damageReportId: row.id }]);
		await vi.waitFor(async () => {
			const mails = await db.select().from(outbox);
			expect(mails).toMatchObject([
				{ to: 'a@example.org', subject: 'Dringende Schadensmeldung: Heizung kalt' }
			]);
			expect(mails[0].text).toContain(`http://localhost/schadensmeldungen/${row.id}`);
		});
		expect(await run(load)).toMatchObject({
			data: { reports: [{ title: 'Heizung kalt', status: 'new' }] }
		});
	});

	it('refuses an incomplete report and more than a few photos', async () => {
		expect(await run(actions.default, { form: { title: '' } })).toMatchObject({
			fail: 400,
			data: { errors: { title: 'Bitte fülle dieses Feld aus.' } }
		});
		const photo = new File([png], 'p.png', { type: 'image/png' });
		expect(
			await run(actions.default, { form: { ...report, photos: [photo, photo, photo, photo] } })
		).toMatchObject({ fail: 400, data: { errors: { photos: 'Höchstens 3 Fotos.' } } });
		expect(await db.select().from(damageReports)).toEqual([]);
	});

	it('refuses reports beyond the daily limit of the link', async () => {
		for (let i = 0; i < 10; i++) await run(actions.default, { form: report });
		expect(await run(actions.default, { form: report })).toMatchObject({ fail: 429 });
	});
});
