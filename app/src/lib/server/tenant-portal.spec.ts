import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_OPEN_DAMAGE_REPORTS, MAX_OPEN_METER_REPORTS } from '../domain/tenant-portal';
import { resetAccount } from './accounts';
import type { Database } from './db';
import { auditLog, documents, meterReadings, tasks, tenantMeterReports } from './db/schema';
import { deleteLease } from './deletion';
import { storeDocument } from './documents';
import { getLease } from './leases';
import { createMeter } from './operating-costs';
import { createStatement, approveStatement, setDelivered } from './statements';
import { deleteTask } from './tasks';
import {
	acceptMeterReport,
	countMeterReports,
	createPortalLink,
	discardMeterReport,
	listDamageReports,
	listMeterReports,
	openPortal,
	openPortalDocument,
	portalLink,
	portalStatement,
	portalView,
	reportDamage,
	reportMeterReading,
	revokePortalLink,
	setDocumentShared,
	type PortalAccess,
	type PortalPhoto
} from './tenant-portal';
import {
	contextA,
	contextB,
	integrityProblems,
	memoryStorage,
	seedCostItem,
	seedLease,
	seedTenant,
	seedUnit,
	testDatabase
} from './testing';

const storage = { current: memoryStorage() };
vi.mock('./storage/index.ts', async (original) => ({
	...(await original<typeof import('./storage/index.ts')>()),
	getStorage: async () => storage.current
}));

const jpeg: PortalPhoto = {
	name: 'IMG_0001.jpg',
	type: 'image/jpeg',
	bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
};

let db: Database;
let leaseId: string;
let propertyId: string;
let unitId: string;
let meterId: string;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
	storage.current = memoryStorage();
	db = await testDatabase();
	({ propertyId, unitId } = await seedUnit(db, 'a', { name: 'Wohnung 3' }));
	const tenantId = await seedTenant(db, 'a', { firstName: 'Lena', lastName: 'Vogt' });
	leaseId = await seedLease(db, 'a', unitId, { tenantIds: [tenantId], startDate: '2024-03-01' });
	const meter = await createMeter(db, contextA, propertyId, {
		unitId,
		kind: 'cold_water',
		serialNumber: 'KW-17',
		unit: 'm³',
		location: 'Bad',
		installedAt: null
	});
	if (!meter.ok) throw new Error(meter.reason);
	meterId = meter.id;
});

afterEach(() => {
	vi.useRealTimers();
});

async function access(token: string): Promise<PortalAccess> {
	const opened = await openPortal(db, token);
	if (!opened) throw new Error('portal does not open');
	return opened;
}

async function link() {
	const lease = (await getLease(db, 'a', leaseId))!;
	return (await createPortalLink(db, contextA, lease)).token;
}

describe('portal links', () => {
	it('opens the lease of its token only, and a new link replaces the old one', async () => {
		expect(await portalLink(db, 'a', leaseId)).toBeNull();
		const first = await link();
		expect((await access(first)).lease.id).toBe(leaseId);
		expect(await portalLink(db, 'a', leaseId)).toEqual({ createdAt: expect.any(Date) });
		const second = await link();
		expect(await openPortal(db, first)).toBeUndefined();
		expect((await access(second)).accountId).toBe('a');
		expect(await openPortal(db, 'kurz')).toBeUndefined();
		expect(await openPortal(db, 'x'.repeat(43))).toBeUndefined();
	});

	it('stops when revoked and a year after the lease ends', async () => {
		const token = await link();
		const lease = (await getLease(db, 'a', leaseId))!;
		expect(await revokePortalLink(db, contextA, lease)).toBe(true);
		expect(await revokePortalLink(db, contextA, lease)).toBe(false);
		expect(await openPortal(db, token)).toBeUndefined();

		const ended = await seedLease(db, 'a', (await seedUnit(db, 'a')).unitId, {
			startDate: '2020-01-01',
			endDate: '2025-10-31'
		});
		const { token: late } = await createPortalLink(db, contextA, (await getLease(db, 'a', ended))!);
		expect(await openPortal(db, late, '2026-10-31')).toBeDefined();
		expect(await openPortal(db, late, '2026-11-01')).toBeUndefined();
		const summaries = (await db.select().from(auditLog)).map((row) => row.summary);
		expect(summaries).toContain('Link zum Mieterportal für Wohnung 3 · Haus gesperrt');
	});

	it('goes with its lease', async () => {
		const token = await link();
		expect(await deleteLease(db, contextA, leaseId)).toBe('deleted');
		expect(await openPortal(db, token)).toBeUndefined();
		expect(await integrityProblems(db)).toEqual([]);
	});
});

describe('portalView', () => {
	it('shows delivered statements, shared documents and the lease’s own meters', async () => {
		const portal = await access(await link());
		// A building meter and a meter of another unit stay out.
		await createMeter(db, contextA, propertyId, {
			unitId: null,
			kind: 'heat',
			serialNumber: 'H-1',
			unit: 'kWh',
			location: null,
			installedAt: null
		});
		const other = await seedUnit(db, 'a');
		await createMeter(db, contextA, other.propertyId, {
			unitId: other.unitId,
			kind: 'cold_water',
			serialNumber: 'FREMD',
			unit: 'm³',
			location: null,
			installedAt: null
		});
		const shared = await storeDocument(db, contextA, {
			name: 'Hausordnung.pdf',
			mimeType: 'application/pdf',
			bytes: new TextEncoder().encode('%PDF-1.7'),
			links: { leaseId }
		});
		const hidden = await storeDocument(db, contextA, {
			name: 'Notiz.pdf',
			mimeType: 'application/pdf',
			bytes: new TextEncoder().encode('%PDF-1.7'),
			links: { leaseId }
		});
		if (!shared.ok || !hidden.ok) throw new Error('upload failed');
		expect(await setDocumentShared(db, contextA, leaseId, shared.id, true)).toBe(true);
		// Unchanged, nothing is logged twice.
		expect(await setDocumentShared(db, contextA, leaseId, shared.id, true)).toBe(true);
		expect(await setDocumentShared(db, contextA, 'other-lease', hidden.id, true)).toBe(false);

		await seedCostItem(db, 'a', propertyId);
		const statement = await createStatement(db, contextA, {
			propertyId,
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31'
		});
		if (!statement.ok) throw new Error(statement.message);
		const approved = await approveStatement(db, contextA, statement.id, {
			lateApprovalJustified: false,
			note: null
		});
		expect(approved).toMatchObject({ ok: true });

		// Approved, but not yet delivered: not shown.
		expect((await portalView(db, portal)).statements).toEqual([]);
		expect(await setDelivered(db, contextA, statement.id, leaseId, '2026-11-27')).toMatchObject({
			ok: true
		});

		const view = await portalView(db, portal);
		expect(view).toMatchObject({
			unit: 'Wohnung 3',
			address: 'Lindenstraße 4, 10115 Berlin',
			tenants: ['Lena Vogt'],
			openUntil: null,
			statements: [{ period: '2025', version: 1, deliveredOn: '2026-11-27' }],
			documents: [{ id: shared.id, name: 'Hausordnung.pdf' }],
			meters: [{ id: meterId, label: 'Kaltwasser KW-17', unit: 'm³', location: 'Bad' }],
			pendingReadings: [],
			damages: []
		});
		expect(await portalStatement(db, portal, view.statements[0].id)).toEqual({
			statementId: statement.id,
			leaseId
		});
		expect(await portalStatement(db, portal, 'unknown')).toBeUndefined();
		expect(await openPortalDocument(db, portal, shared.id)).toMatchObject({
			contentType: 'application/pdf'
		});
		expect(await openPortalDocument(db, portal, hidden.id)).toBeUndefined();
	});
});

describe('reportMeterReading', () => {
	it('waits for the landlord, who takes it over as a reading', async () => {
		const portal = await access(await link());
		expect(
			await reportMeterReading(db, portal, {
				meterId,
				readAt: '2026-11-26',
				value: 123.4,
				note: 'abgelesen um 8 Uhr',
				photo: jpeg
			})
		).toEqual({ ok: true });
		const [report] = await listMeterReports(db, 'a', leaseId);
		expect(report).toMatchObject({
			meter: 'Kaltwasser KW-17',
			readAt: '2026-11-26',
			value: 123.4,
			documentId: expect.any(String)
		});
		const [photo] = await db.select().from(documents).where(eq(documents.id, report.documentId!));
		expect(photo).toMatchObject({
			name: 'Zählerfoto Kaltwasser KW-17 26.11.2026.jpg',
			mimeType: 'image/jpeg',
			leaseId,
			unitId,
			uploadedBy: null,
			sharedWithTenant: false
		});
		expect((await portalView(db, portal)).pendingReadings).toEqual([
			{ id: report.id, meter: 'Kaltwasser KW-17', readAt: '2026-11-26', value: 123.4, unit: 'm³' }
		]);
		expect(await countMeterReports(db, 'a')).toEqual([{ leaseId, count: 1 }]);

		expect(await acceptMeterReport(db, contextA, leaseId, report.id)).toBe('accepted');
		expect(await db.select().from(meterReadings)).toMatchObject([
			{
				meterId,
				readAt: '2026-11-26',
				value: 123.4,
				note: 'Vom Mieter gemeldet: abgelesen um 8 Uhr'
			}
		]);
		expect(await listMeterReports(db, 'a', leaseId)).toEqual([]);
		expect(await acceptMeterReport(db, contextA, leaseId, report.id)).toBe('missing');
	});

	it('refuses a reading of the same day twice and lets the landlord discard it', async () => {
		const portal = await access(await link());
		const input = { meterId, readAt: '2026-11-26', value: 10, note: null, photo: null };
		await reportMeterReading(db, portal, input);
		await reportMeterReading(db, portal, { ...input, value: 11 });
		const [first, second] = await listMeterReports(db, 'a', leaseId);
		expect(await acceptMeterReport(db, contextA, leaseId, first.id)).toBe('accepted');
		expect(await acceptMeterReport(db, contextA, leaseId, second.id)).toBe('duplicate-date');
		expect(await discardMeterReport(db, contextA, leaseId, second.id)).toBe(true);
		expect(await discardMeterReport(db, contextA, leaseId, second.id)).toBe(false);
		// Another account cannot reach the report.
		await reportMeterReading(db, portal, { ...input, readAt: '2026-11-25' });
		const [third] = await listMeterReports(db, 'a', leaseId);
		expect(await discardMeterReport(db, contextB, leaseId, third.id)).toBe(false);
		expect(await acceptMeterReport(db, contextB, leaseId, third.id)).toBe('missing');
	});

	it('refuses other meters, dates outside the lease, non-photos and a flood', async () => {
		const portal = await access(await link());
		const input = { meterId, readAt: '2026-11-26', value: 10, note: null, photo: null };
		expect(await reportMeterReading(db, portal, { ...input, meterId: 'other' })).toEqual({
			ok: false,
			reason: 'unknown-meter'
		});
		expect(await reportMeterReading(db, portal, { ...input, readAt: '2026-11-28' })).toEqual({
			ok: false,
			reason: 'future-date'
		});
		expect(await reportMeterReading(db, portal, { ...input, readAt: '2024-02-29' })).toEqual({
			ok: false,
			reason: 'before-lease'
		});
		const html = { name: 'x.jpg', type: 'image/jpeg', bytes: new TextEncoder().encode('<html>') };
		expect(await reportMeterReading(db, portal, { ...input, photo: html })).toEqual({
			ok: false,
			reason: 'not-a-photo'
		});
		for (let day = 1; day <= MAX_OPEN_METER_REPORTS; day++) {
			const readAt = `2026-10-${String(day).padStart(2, '0')}`;
			expect(await reportMeterReading(db, portal, { ...input, readAt })).toEqual({ ok: true });
		}
		expect(await reportMeterReading(db, portal, input)).toEqual({ ok: false, reason: 'too-many' });
	});
});

describe('reportDamage', () => {
	const input = {
		title: 'Wasserhahn tropft',
		description: 'Der Wasserhahn in der Küche tropft seit gestern.',
		reporter: 'Lena Vogt',
		phone: '0170 1234567',
		photos: [jpeg, jpeg]
	};

	it('becomes an open repair task of the lease with the photos as its documents', async () => {
		const portal = await access(await link());
		expect(await reportDamage(db, portal, input)).toEqual({ ok: true, photosStored: 2 });
		const [task] = await db.select().from(tasks);
		expect(task).toMatchObject({
			title: 'Schaden: Wasserhahn tropft',
			category: 'repair',
			leaseId,
			propertyId,
			done: false,
			reportedByTenant: true,
			note: 'Der Wasserhahn in der Küche tropft seit gestern.\n\nGemeldet über das Mieterportal von Lena Vogt am 27.11.2026, Rückruf unter 0170 1234567.'
		});
		const photos = await db.select().from(documents).where(eq(documents.taskId, task.id));
		expect(photos.map((photo) => photo.name).sort()).toEqual([
			'Schadensfoto 27.11.2026 1.jpg',
			'Schadensfoto 27.11.2026 2.jpg'
		]);
		expect(await listDamageReports(db, 'a', leaseId)).toMatchObject([{ id: task.id, done: false }]);
		expect((await portalView(db, portal)).damages).toMatchObject([
			{ id: task.id, title: 'Schaden: Wasserhahn tropft', done: false }
		]);

		// Deleting the task keeps the photos with the lease.
		expect(await deleteTask(db, contextA, task.id)).toBe(true);
		expect(await db.select().from(documents)).toHaveLength(2);
		expect(await integrityProblems(db)).toEqual([]);
	});

	it('refuses a non-photo and a flood of open reports', async () => {
		const portal = await access(await link());
		const pdf = {
			name: 'a.pdf',
			type: 'application/pdf',
			bytes: new TextEncoder().encode('%PDF-')
		};
		expect(await reportDamage(db, portal, { ...input, photos: [pdf] })).toEqual({
			ok: false,
			reason: 'not-a-photo'
		});
		for (let index = 0; index < MAX_OPEN_DAMAGE_REPORTS; index++) {
			await reportDamage(db, portal, { ...input, photos: [] });
		}
		expect(await reportDamage(db, portal, { ...input, photos: [] })).toEqual({
			ok: false,
			reason: 'too-many'
		});
		// A done report no longer counts.
		await db.update(tasks).set({ done: true }).where(eq(tasks.leaseId, leaseId));
		expect(await reportDamage(db, portal, { ...input, photos: [] })).toMatchObject({ ok: true });
	});
});

describe('resetAccount', () => {
	it('clears the portal with the rest of the landlord’s data', async () => {
		const portal = await access(await link());
		await reportMeterReading(db, portal, {
			meterId,
			readAt: '2026-11-26',
			value: 1,
			note: null,
			photo: jpeg
		});
		await reportDamage(db, portal, {
			title: 'Fenster',
			description: 'klemmt',
			reporter: 'Lena',
			phone: null,
			photos: [jpeg]
		});
		await resetAccount(db, contextA, { storage: storage.current });
		expect(await db.select().from(tenantMeterReports)).toEqual([]);
		expect(await db.select().from(tasks)).toEqual([]);
		expect(await integrityProblems(db)).toEqual([]);
	});
});
