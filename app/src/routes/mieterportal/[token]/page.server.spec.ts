import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { statementResults, tasks, units } from '#lib/server/db/schema.ts';
import { approveStatement, createStatement, setDelivered } from '#lib/server/statements.ts';
import { storeDocument } from '#lib/server/documents.ts';
import { getLease } from '#lib/server/leases.ts';
import { createMeter } from '#lib/server/operating-costs.ts';
import {
	createPortalLink,
	listMeterReports,
	setDocumentShared
} from '#lib/server/tenant-portal.ts';
import {
	contextA,
	memoryStorage,
	outcome,
	routeEvent,
	seedCostItem,
	seedLease,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { actions, load } from './+page.server';
import { GET as statementPdf } from './abrechnungen/[id]/+server';
import { GET as documentDownload } from './dokumente/[id]/+server';

const storage = { current: memoryStorage() };
vi.mock('#lib/server/storage/index.ts', async (original) => ({
	...(await original<typeof import('#lib/server/storage/index.ts')>()),
	getStorage: async () => storage.current
}));

let db: Database;
let token: string;
let leaseId: string;
let meterId: string;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
	storage.current = memoryStorage();
	db = await testDatabase();
	const { propertyId, unitId } = await seedUnit(db, 'a', { name: 'Wohnung 3' });
	leaseId = await seedLease(db, 'a', unitId, { startDate: '2024-03-01' });
	const meter = await createMeter(db, contextA, propertyId, {
		unitId,
		kind: 'hot_water',
		serialNumber: 'WW-2',
		unit: 'm³',
		location: null,
		installedAt: null
	});
	if (!meter.ok) throw new Error(meter.reason);
	meterId = meter.id;
	({ token } = await createPortalLink(db, contextA, (await getLease(db, 'a', leaseId))!));
});

afterEach(() => {
	vi.useRealTimers();
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, { user: null, params: { token }, ...options })));
}

describe('/mieterportal/[token]/abrechnungen/[id]', () => {
	it('prints a statement once it reached the tenants', async () => {
		const [unit] = await db.select({ propertyId: units.propertyId }).from(units);
		await seedCostItem(db, 'a', unit.propertyId);
		const statement = await createStatement(db, contextA, {
			propertyId: unit.propertyId,
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31'
		});
		if (!statement.ok) throw new Error(statement.message);
		await approveStatement(db, contextA, statement.id, {
			lateApprovalJustified: false,
			note: null
		});
		await setDelivered(db, contextA, statement.id, leaseId, '2026-11-27');
		const [result] = await db.select({ id: statementResults.id }).from(statementResults);
		const served = (await outcome(() =>
			statementPdf(routeEvent(db, { user: null, params: { token, id: result.id } }))
		)) as { data: Response };
		expect(served.data.headers.get('Content-Type')).toBe('application/pdf');
	});
});

describe('/mieterportal/[token]', () => {
	it('shows the portal, or a notice for an unknown link', async () => {
		expect(await run(load)).toMatchObject({
			data: {
				state: 'open',
				today: '2026-11-27',
				view: { unit: 'Wohnung 3', meters: [{ id: meterId }] },
				notice: expect.arrayContaining([expect.stringContaining('Art. 28 DSGVO')])
			}
		});
		expect(await run(load, { params: { token: 'x'.repeat(43) } })).toEqual({
			data: { state: 'invalid' }
		});
	});

	it('takes a meter reading and explains a refusal', async () => {
		expect(
			await run(actions.meter, {
				form: { meterId, readAt: '2026-11-26', value: '12,5', note: '' }
			})
		).toEqual({ data: { which: 'meter', sent: true } });
		expect(await listMeterReports(db, 'a', leaseId)).toHaveLength(1);
		expect(
			await run(actions.meter, { form: { meterId, readAt: '2026-11-30', value: '12,5' } })
		).toEqual({
			fail: 400,
			data: {
				which: 'meter',
				errors: { readAt: 'Das Datum liegt in der Zukunft.' },
				values: { meterId, readAt: '2026-11-30', value: '12,5', note: '' }
			}
		});
		const notPhoto = new File(['<html>'], 'x.jpg', { type: 'image/jpeg' });
		expect(
			await run(actions.meter, {
				form: { meterId, readAt: '2026-11-26', value: '1', photo: notPhoto }
			})
		).toMatchObject({ fail: 400, data: { errors: { photo: expect.stringContaining('Foto') } } });
		expect(
			await run(actions.meter, { form: { meterId: '', readAt: '', value: '' } })
		).toMatchObject({
			fail: 400,
			data: { which: 'meter', errors: { meterId: expect.any(String) } }
		});
		expect(
			await run(actions.meter, { params: { token: 'x'.repeat(43) }, form: { meterId } })
		).toEqual({ fail: 400, data: { invalid: true } });
	});

	it('turns a damage report into a repair task', async () => {
		const form = {
			title: 'Heizung kalt',
			description: 'Der Heizkörper im Bad wird nicht warm.',
			reporter: 'Lena Vogt',
			phone: '',
			photos: new File([new Uint8Array([0xff, 0xd8, 0xff, 0])], 'a.jpg', { type: 'image/jpeg' })
		};
		expect(await run(actions.damage, { form })).toEqual({
			data: { which: 'damage', sent: true, photosMissing: 0 }
		});
		expect(await db.select({ title: tasks.title }).from(tasks)).toEqual([
			{ title: 'Schaden: Heizung kalt' }
		]);
		const pdf = new File(['%PDF-'], 'a.pdf', { type: 'application/pdf' });
		expect(await run(actions.damage, { form: { ...form, photos: pdf } })).toMatchObject({
			fail: 400,
			data: { which: 'damage', errors: { photos: expect.stringContaining('Foto') } }
		});
		expect(await run(actions.damage, { form: { ...form, title: '' } })).toMatchObject({
			fail: 400,
			data: { which: 'damage', errors: { title: expect.any(String) } }
		});
		expect(await run(actions.damage, { params: { token: 'x'.repeat(43) }, form })).toEqual({
			fail: 400,
			data: { invalid: true }
		});
	});

	it('serves shared documents only, and no unknown statement', async () => {
		const stored = await storeDocument(db, contextA, {
			name: 'Hausordnung.pdf',
			mimeType: 'application/pdf',
			bytes: new TextEncoder().encode('%PDF-1.7'),
			links: { leaseId }
		});
		if (!stored.ok) throw new Error(stored.reason);
		const download = () =>
			outcome(() =>
				documentDownload(
					routeEvent(db, {
						user: null,
						params: { token, id: stored.id },
						url: `/mieterportal/${token}/dokumente/${stored.id}?inline=1`
					})
				)
			);
		expect(await download()).toEqual({ error: 404, message: 'Dieses Dokument gibt es nicht.' });
		await setDocumentShared(db, contextA, leaseId, stored.id, true);
		const served = (await download()) as { data: Response };
		expect(served.data.headers.get('Content-Type')).toBe('application/pdf');
		expect(served.data.headers.get('Content-Disposition')).toContain('inline');
		expect(
			await outcome(() =>
				documentDownload(
					routeEvent(db, { user: null, params: { token: 'x'.repeat(43), id: stored.id } })
				)
			)
		).toEqual({ error: 404, message: 'Dieser Link gilt nicht mehr.' });

		expect(
			await outcome(() =>
				statementPdf(routeEvent(db, { user: null, params: { token, id: 'none' } }))
			)
		).toEqual({ error: 404, message: 'Diese Abrechnung gibt es nicht.' });
		expect(
			await outcome(() =>
				statementPdf(routeEvent(db, { user: null, params: { token: 'x'.repeat(43), id: 'none' } }))
			)
		).toEqual({ error: 404, message: 'Dieser Link gilt nicht mehr.' });
	});
});
