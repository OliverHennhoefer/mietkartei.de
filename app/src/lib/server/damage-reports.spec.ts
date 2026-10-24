import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	countNewDamageReports,
	createDamageReport,
	createTaskFromReport,
	damageReportMail,
	deleteDamageReport,
	getDamageReport,
	listDamageReports,
	listPortalReports,
	listReportPhotos,
	MAX_REPORTS_PER_DAY,
	updateDamageReport,
	type DamageReportInput
} from './damage-reports';
import type { Database } from './db';
import { auditLog, damageReports, documents } from './db/schema';
import { getTask } from './tasks';
import { contextA, contextB, memoryStorage, seedLease, seedUnit, testDatabase } from './testing';

let db: Database;
let leaseId: string;
let otherLeaseId: string;
let storage: ReturnType<typeof memoryStorage>;

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const input = (overrides: Partial<DamageReportInput> = {}): DamageReportInput => ({
	title: 'Wasserhahn tropft',
	description: 'Seit Montag, auch zugedreht.',
	location: 'Bad',
	urgent: false,
	reporterName: 'Erika Mustermann',
	reporterPhone: '0171 123456',
	...overrides
});

beforeEach(async () => {
	db = await testDatabase();
	storage = memoryStorage();
	const { unitId } = await seedUnit(db, 'a', { name: 'EG links', propertyName: 'Haus' });
	leaseId = await seedLease(db, 'a', unitId);
	const other = await seedUnit(db, 'b');
	otherLeaseId = await seedLease(db, 'b', other.unitId);
});

async function report(overrides: Partial<DamageReportInput> = {}) {
	const result = await createDamageReport(db, { accountId: 'a', leaseId }, input(overrides));
	if (!result.ok) throw new Error(result.reason);
	return result.id;
}

describe('createDamageReport', () => {
	it('stores the report as new, without a user, with an audit line', async () => {
		const id = await report();
		expect(await getDamageReport(db, 'a', id)).toMatchObject({
			title: 'Wasserhahn tropft',
			status: 'new',
			reply: null,
			lease: { id: leaseId, label: 'EG links · Haus' }
		});
		const [entry] = await db.select().from(auditLog).where(eq(auditLog.entity, 'damageReport'));
		expect(entry).toMatchObject({
			userId: null,
			summary:
				'Schadensmeldung „Wasserhahn tropft“ zu EG links · Haus über das Mieterportal eingegangen'
		});
	});

	it('keeps image photos only, linked to the report, the lease and its unit', async () => {
		const result = await createDamageReport(
			db,
			{ accountId: 'a', leaseId },
			input(),
			[
				{ name: 'tropfen.png', mimeType: 'image/png', bytes: png },
				{ name: 'falsch.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
				{ name: 'notiz.txt', mimeType: 'text/plain', bytes: new Uint8Array([65]) }
			],
			Date.now(),
			{ storage }
		);
		expect(result).toMatchObject({ ok: true, photos: 1 });
		if (!result.ok) return;
		const photos = await listReportPhotos(db, 'a', result.id);
		expect(photos).toMatchObject([
			{ name: 'tropfen.png', mimeType: 'image/png', leaseId, uploadedBy: null }
		]);
		expect(photos[0].unitId).not.toBeNull();
		expect(storage.files.size).toBe(1);
	});

	it('refuses more than MAX_REPORTS_PER_DAY reports of a lease within a day', async () => {
		const now = Date.now();
		for (let i = 0; i < MAX_REPORTS_PER_DAY; i++) {
			await createDamageReport(db, { accountId: 'a', leaseId }, input(), [], now);
		}
		expect(await createDamageReport(db, { accountId: 'a', leaseId }, input(), [], now)).toEqual({
			ok: false,
			reason: 'too-many'
		});
		expect(
			await createDamageReport(db, { accountId: 'a', leaseId }, input(), [], now + 25 * 3600_000)
		).toMatchObject({ ok: true });
	});
});

describe('lists', () => {
	it('lists open reports new before in progress, done apart, per account and lease', async () => {
		const first = await report({ title: 'Erste' });
		const second = await report({ title: 'Zweite' });
		const third = await report({ title: 'Dritte' });
		await updateDamageReport(db, contextA, first, { status: 'in_progress', reply: null });
		await updateDamageReport(db, contextA, third, { status: 'done', reply: null });
		await createDamageReport(db, { accountId: 'b', leaseId: otherLeaseId }, input());

		const { open, done } = await listDamageReports(db, 'a');
		expect(open.map((row) => row.id)).toEqual([second, first]);
		expect(done.map((row) => row.id)).toEqual([third]);
		expect((await listDamageReports(db, 'a', { leaseId: otherLeaseId })).open).toEqual([]);
		expect(await countNewDamageReports(db, 'a')).toBe(1);
		expect(await getDamageReport(db, 'b', first)).toBeUndefined();
	});

	it('shows the tenants their own reports with the reply, nothing about the reporter', async () => {
		const id = await report();
		await updateDamageReport(db, contextA, id, { status: 'in_progress', reply: 'Kommt Do.' });
		const [row] = await listPortalReports(db, { accountId: 'a', leaseId });
		expect(row).toMatchObject({ id, status: 'in_progress', reply: 'Kommt Do.' });
		expect(Object.keys(row).sort()).toEqual(
			['createdAt', 'id', 'location', 'reply', 'status', 'title', 'updatedAt', 'urgent'].sort()
		);
		expect(await listPortalReports(db, { accountId: 'b', leaseId })).toEqual([]);
	});
});

describe('updateDamageReport', () => {
	it('sets status and reply in the account only and says what changed', async () => {
		const id = await report();
		expect(await updateDamageReport(db, contextB, id, { status: 'done', reply: 'Erledigt' })).toBe(
			false
		);
		expect(
			await updateDamageReport(db, contextA, id, { status: 'in_progress', reply: 'Kommt Do.' })
		).toBe(true);
		const updated = await getDamageReport(db, 'a', id);
		expect(updated).toMatchObject({ status: 'in_progress', reply: 'Kommt Do.' });
		expect(updated?.updatedAt).toBeInstanceOf(Date);
		const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'update'));
		expect(entries.map((entry) => entry.summary)).toEqual([
			'Schadensmeldung „Wasserhahn tropft“ geändert: Status „In Bearbeitung“, Antwort an die Mieter'
		]);
	});
});

describe('createTaskFromReport', () => {
	it('makes one task linked to the lease and moves a new report on', async () => {
		const id = await report();
		const result = await createTaskFromReport(db, contextA, id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(await getTask(db, 'a', result.taskId)).toMatchObject({
			title: 'Schaden: Wasserhahn tropft',
			leaseId,
			note: 'Ort: Bad\n\nSeit Montag, auch zugedreht.'
		});
		expect(await getDamageReport(db, 'a', id)).toMatchObject({
			taskId: result.taskId,
			status: 'in_progress'
		});
		expect(await createTaskFromReport(db, contextA, id)).toEqual(result);
		expect(await createTaskFromReport(db, contextB, id)).toEqual({ ok: false, reason: 'missing' });
	});
});

describe('deleteDamageReport', () => {
	it('deletes the report with its photos', async () => {
		const result = await createDamageReport(
			db,
			{ accountId: 'a', leaseId },
			input(),
			[{ name: 'tropfen.png', mimeType: 'image/png', bytes: png }],
			Date.now(),
			{ storage }
		);
		if (!result.ok) throw new Error(result.reason);
		expect(await deleteDamageReport(db, contextB, result.id, { storage })).toBe(false);
		expect(await deleteDamageReport(db, contextA, result.id, { storage })).toBe(true);
		expect(await db.select().from(damageReports)).toEqual([]);
		expect(await db.select().from(documents)).toEqual([]);
		expect(storage.files.size).toBe(0);
	});
});

describe('damageReportMail', () => {
	it('tells the landlord what was reported, with a link when there is one', () => {
		const mail = damageReportMail(
			'a@example.org',
			input({ urgent: true }),
			'EG links · Haus',
			'https://app.example.org/schadensmeldungen/1'
		);
		expect(mail.subject).toBe('Dringende Schadensmeldung: Wasserhahn tropft');
		expect(mail.text).toContain('über das Mieterportal von EG links · Haus');
		expect(mail.text).toContain('als dringend markiert');
		expect(mail.text).toContain('Ort: Bad');
		expect(mail.text).toContain('Gemeldet von: Erika Mustermann, 0171 123456');
		expect(mail.text).toContain('Zur Meldung: https://app.example.org/schadensmeldungen/1');
		const plain = damageReportMail(
			'a@example.org',
			input({ reporterName: null, reporterPhone: null, location: null }),
			'X',
			undefined
		);
		expect(plain.subject).toBe('Neue Schadensmeldung: Wasserhahn tropft');
		expect(plain.text).not.toContain('Gemeldet von');
		expect(plain.text).not.toContain('Zur Meldung');
	});
});
