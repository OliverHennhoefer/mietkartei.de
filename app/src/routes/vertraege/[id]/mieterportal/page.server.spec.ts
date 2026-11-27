import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { documents, meterReadings } from '#lib/server/db/schema.ts';
import { storeDocument } from '#lib/server/documents.ts';
import { getLease } from '#lib/server/leases.ts';
import { createMeter } from '#lib/server/operating-costs.ts';
import { openPortal, reportDamage, reportMeterReading } from '#lib/server/tenant-portal.ts';
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

const storage = { current: memoryStorage() };
vi.mock('#lib/server/storage/index.ts', async (original) => ({
	...(await original<typeof import('#lib/server/storage/index.ts')>()),
	getStorage: async () => storage.current
}));

let db: Database;
let leaseId: string;
let meterId: string;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
	storage.current = memoryStorage();
	db = await testDatabase();
	const { propertyId, unitId } = await seedUnit(db, 'a');
	leaseId = await seedLease(db, 'a', unitId, { startDate: '2024-03-01', endDate: '2027-02-28' });
	const meter = await createMeter(db, contextA, propertyId, {
		unitId,
		kind: 'electricity',
		serialNumber: 'S-9',
		unit: 'kWh',
		location: null,
		installedAt: null
	});
	if (!meter.ok) throw new Error(meter.reason);
	meterId = meter.id;
});

afterEach(() => {
	vi.useRealTimers();
});

async function run(
	handler: (event: never) => unknown,
	options: Parameters<typeof routeEvent>[1] = {}
) {
	const lease = await getLease(db, 'a', leaseId);
	return outcome(() =>
		handler(
			routeEvent(db, {
				params: { id: leaseId },
				url: `/vertraege/${leaseId}/mieterportal`,
				parent: { lease },
				...options
			})
		)
	);
}

describe('/vertraege/[id]/mieterportal', () => {
	it('creates a link shown once, which opens the portal, and revokes it', async () => {
		const created = (await run(actions.link)) as { data: { linkUrl: string } };
		expect(created.data.linkUrl).toMatch(/^http:\/\/localhost\/mieterportal\/[\w-]{43}$/);
		const token = created.data.linkUrl.split('/').pop()!;
		expect(await openPortal(db, token)).toBeDefined();
		expect(await run(load)).toMatchObject({
			data: { link: { createdAt: expect.any(Date) }, openUntil: '2028-02-28' }
		});
		expect(await run(actions.revoke)).toEqual({ data: { revoked: true } });
		expect(await openPortal(db, token)).toBeUndefined();
		expect(await run(actions.link, { params: { id: 'other' } })).toEqual({
			error: 404,
			message: 'Diesen Mietvertrag gibt es nicht.'
		});
		expect(await run(actions.revoke, { params: { id: 'other' } })).toMatchObject({ error: 404 });
	});

	it('shares documents and handles reported readings', async () => {
		const stored = await storeDocument(db, contextA, {
			name: 'Hausordnung.pdf',
			mimeType: 'application/pdf',
			bytes: new TextEncoder().encode('%PDF-1.7'),
			links: { leaseId }
		});
		if (!stored.ok) throw new Error(stored.reason);
		expect(await run(actions.share, { form: { documentId: stored.id, shared: '1' } })).toEqual({
			data: { shared: true }
		});
		expect((await db.select({ shared: documents.sharedWithTenant }).from(documents))[0]).toEqual({
			shared: true
		});
		expect(await run(actions.share, { form: { documentId: 'x', shared: '1' } })).toMatchObject({
			error: 404
		});
		expect(await run(actions.share, { form: {} })).toMatchObject({ error: 400 });

		const access = (await openPortal(
			db,
			((await run(actions.link)) as { data: { linkUrl: string } }).data.linkUrl.split('/').pop()!
		))!;
		const reading = { meterId, readAt: '2026-11-26', value: 4711, note: null, photo: null };
		await reportMeterReading(db, access, reading);
		await reportMeterReading(db, access, { ...reading, value: 4712 });
		await reportDamage(db, access, {
			title: 'Tür',
			description: 'klemmt',
			reporter: 'Lena',
			phone: null,
			photos: []
		});
		const page = (await run(load)) as {
			data: { meterReports: { id: string }[]; damages: unknown[]; documents: unknown[] };
		};
		expect(page.data.damages).toHaveLength(1);
		expect(page.data.documents).toMatchObject([{ shared: true, fromTenant: false }]);
		const [first, second] = page.data.meterReports;
		expect(await run(actions.accept, { form: { reportId: first.id } })).toEqual({
			data: { accepted: true }
		});
		expect(await db.select({ value: meterReadings.value }).from(meterReadings)).toEqual([
			{ value: 4711 }
		]);
		expect(await run(actions.accept, { form: { reportId: second.id } })).toMatchObject({
			fail: 400,
			data: { reportId: second.id, message: expect.stringContaining('schon einen Zählerstand') }
		});
		expect(await run(actions.accept, { form: { reportId: 'gone' } })).toMatchObject({ error: 404 });
		expect(await run(actions.accept, { form: {} })).toMatchObject({ error: 400 });
		expect(await run(actions.discard, { form: { reportId: second.id } })).toEqual({
			data: { discarded: true }
		});
		expect(await run(actions.discard, { form: { reportId: second.id } })).toMatchObject({
			error: 404
		});
		expect(await run(actions.discard, { form: {} })).toMatchObject({ error: 400 });
	});
});
