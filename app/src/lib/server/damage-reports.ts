import { and, asc, count, desc, eq, gt } from 'drizzle-orm';
import { canInline, storedMimeType } from '../domain/documents';
import { damageReportStatusLabels } from '../labels';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import {
	damageReports,
	documents,
	leases,
	properties,
	units,
	type DamageReportStatus
} from './db/schema';
import { deleteDocument, storeDocument, type Document } from './documents';
import { assertQuota } from './quotas';
import type { Storage } from './storage';
import type { Mail } from './mail';
import { createTask } from './tasks';

// Schadensmeldungen: what tenants report through the Mieterportal (portal.ts). The landlord moves
// a report from "Eingegangen" to "In Bearbeitung" and "Erledigt", answers the tenants with a reply
// they see in the portal, and can make a task of it. Photos are documents linked to the report,
// the lease and its property, so they also show in the lease's Dokumente tab.

/** Reports one lease may send within a day, so a leaked link cannot flood the landlord. */
export const MAX_REPORTS_PER_DAY = 10;
export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const DAY = 24 * 60 * 60 * 1000;

export type DamageReportInput = {
	title: string;
	description: string;
	location: string | null;
	urgent: boolean;
	reporterName: string | null;
	reporterPhone: string | null;
};

export type PhotoInput = { name: string; mimeType: string; bytes: Uint8Array };

export type DamageReportUpdate = { status: DamageReportStatus; reply: string | null };

export type DamageReportRow = typeof damageReports.$inferSelect;

export type DamageReport = DamageReportRow & {
	/** The lease with its label ("EG links · Haus"), when the lease still exists. */
	lease: { id: string; label: string; propertyId: string } | null;
};

/** What the tenants see of their reports in the portal. */
export type PortalReport = Pick<
	DamageReportRow,
	'id' | 'title' | 'location' | 'urgent' | 'status' | 'reply' | 'createdAt' | 'updatedAt'
>;

type StorageOptions = { storage?: Storage };

/** The leases of the account by id, with their labels; one query however many reports there are. */
async function leaseLabels(db: Database, accountId: string) {
	const rows = await db
		.select({
			id: leases.id,
			unitName: units.name,
			propertyId: properties.id,
			propertyName: properties.name
		})
		.from(leases)
		.innerJoin(units, eq(leases.unitId, units.id))
		.innerJoin(properties, eq(units.propertyId, properties.id))
		.where(eq(leases.accountId, accountId));
	return new Map(
		rows.map((row) => [
			row.id,
			{ id: row.id, label: `${row.unitName} · ${row.propertyName}`, propertyId: row.propertyId }
		])
	);
}

async function decorate(
	db: Database,
	accountId: string,
	rows: DamageReportRow[]
): Promise<DamageReport[]> {
	if (rows.length === 0) return [];
	const byId = await leaseLabels(db, accountId);
	return rows.map((row) => ({ ...row, lease: (row.leaseId && byId.get(row.leaseId)) || null }));
}

/**
 * Stores a report sent through the portal of the lease, with up to MAX_PHOTOS photos. Photos
 * that are not a PNG, JPEG, GIF or WebP by their bytes, or do not fit the account's storage, are
 * left out; the result says how many were kept.
 */
export async function createDamageReport(
	db: Database,
	portal: { accountId: string; leaseId: string },
	input: DamageReportInput,
	photos: PhotoInput[] = [],
	now = Date.now(),
	options?: StorageOptions
): Promise<{ ok: true; id: string; photos: number } | { ok: false; reason: 'too-many' }> {
	const { accountId, leaseId } = portal;
	await assertQuota(db, accountId, 'damageReports');
	const [recent] = await db
		.select({ value: count() })
		.from(damageReports)
		.where(
			and(
				eq(damageReports.accountId, accountId),
				eq(damageReports.leaseId, leaseId),
				gt(damageReports.createdAt, new Date(now - DAY))
			)
		);
	if (recent.value >= MAX_REPORTS_PER_DAY) return { ok: false, reason: 'too-many' };

	const [lease] = await db
		.select({
			unitId: units.id,
			unitName: units.name,
			propertyId: properties.id,
			propertyName: properties.name
		})
		.from(leases)
		.innerJoin(units, eq(leases.unitId, units.id))
		.innerJoin(properties, eq(units.propertyId, properties.id))
		.where(and(eq(leases.accountId, accountId), eq(leases.id, leaseId)));
	// The portal link is deleted with its lease, so a found portal has one.
	if (!lease) throw new Error(`Lease ${leaseId} of a portal link is missing`);

	// Reports come from tenants, who are no users of the account.
	const context: AuditContext = { accountId, userId: null };
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(damageReports).values({ id, accountId, leaseId, ...input, createdAt: new Date(now) }),
		auditEntry(
			db,
			context,
			'damageReport',
			id,
			'create',
			`Schadensmeldung „${input.title}“ zu ${lease.unitName} · ${lease.propertyName} über das Mieterportal eingegangen`
		)
	]);

	let stored = 0;
	for (const photo of photos.slice(0, MAX_PHOTOS)) {
		const type = storedMimeType(photo.mimeType, photo.bytes);
		if (!type.startsWith('image/') || !canInline(type)) continue;
		if (photo.bytes.byteLength > MAX_PHOTO_BYTES) continue;
		const result = await storeDocument(
			db,
			context,
			{
				name: photo.name,
				mimeType: type,
				bytes: photo.bytes,
				links: {
					leaseId,
					unitId: lease.unitId,
					propertyId: lease.propertyId,
					damageReportId: id
				}
			},
			options
		);
		if (result.ok) stored++;
	}
	return { ok: true, id, photos: stored };
}

/** Open reports (Eingegangen first, then In Bearbeitung, newest first), done ones newest first. */
export async function listDamageReports(
	db: Database,
	accountId: string,
	filter: { leaseId?: string } = {}
): Promise<{ open: DamageReport[]; done: DamageReport[] }> {
	const conditions = [eq(damageReports.accountId, accountId)];
	if (filter.leaseId) conditions.push(eq(damageReports.leaseId, filter.leaseId));
	const rows = await db
		.select()
		.from(damageReports)
		.where(and(...conditions))
		.orderBy(desc(damageReports.createdAt));
	const all = await decorate(db, accountId, rows);
	const rank: Record<DamageReportStatus, number> = { new: 0, in_progress: 1, done: 2 };
	const open = all
		.filter((report) => report.status !== 'done')
		.sort((a, b) => rank[a.status] - rank[b.status]);
	return { open, done: all.filter((report) => report.status === 'done') };
}

/** Reports nobody has looked at yet ("Eingegangen"), for the dashboard. */
export async function countNewDamageReports(db: Database, accountId: string): Promise<number> {
	const [row] = await db
		.select({ value: count() })
		.from(damageReports)
		.where(and(eq(damageReports.accountId, accountId), eq(damageReports.status, 'new')));
	return row?.value ?? 0;
}

export async function getDamageReport(
	db: Database,
	accountId: string,
	reportId: string
): Promise<DamageReport | undefined> {
	const rows = await db
		.select()
		.from(damageReports)
		.where(and(eq(damageReports.accountId, accountId), eq(damageReports.id, reportId)));
	const [report] = await decorate(db, accountId, rows);
	return report;
}

/** The photos of a report, in the order they were sent. */
export async function listReportPhotos(
	db: Database,
	accountId: string,
	reportId: string
): Promise<Document[]> {
	return db
		.select()
		.from(documents)
		.where(and(eq(documents.accountId, accountId), eq(documents.damageReportId, reportId)))
		.orderBy(asc(documents.createdAt), asc(documents.name));
}

/** The reports of the lease as its tenants see them in the portal, newest first. */
export async function listPortalReports(
	db: Database,
	portal: { accountId: string; leaseId: string }
): Promise<PortalReport[]> {
	return db
		.select({
			id: damageReports.id,
			title: damageReports.title,
			location: damageReports.location,
			urgent: damageReports.urgent,
			status: damageReports.status,
			reply: damageReports.reply,
			createdAt: damageReports.createdAt,
			updatedAt: damageReports.updatedAt
		})
		.from(damageReports)
		.where(
			and(eq(damageReports.accountId, portal.accountId), eq(damageReports.leaseId, portal.leaseId))
		)
		.orderBy(desc(damageReports.createdAt));
}

/** Sets the status and the reply the tenants see. False when the report is not in the account. */
export async function updateDamageReport(
	db: Database,
	context: AuditContext,
	reportId: string,
	input: DamageReportUpdate
): Promise<boolean> {
	const { accountId } = context;
	const existing = await getDamageReport(db, accountId, reportId);
	if (!existing) return false;
	const changes: string[] = [];
	if (existing.status !== input.status) {
		changes.push(`Status „${damageReportStatusLabels[input.status]}“`);
	}
	if ((existing.reply ?? null) !== input.reply) {
		changes.push(input.reply ? 'Antwort an die Mieter' : 'Antwort entfernt');
	}
	if (changes.length === 0) return true;
	await runBatch(db, [
		db
			.update(damageReports)
			.set({ ...input, updatedAt: new Date() })
			.where(and(eq(damageReports.accountId, accountId), eq(damageReports.id, reportId))),
		auditEntry(
			db,
			context,
			'damageReport',
			reportId,
			'update',
			`Schadensmeldung „${existing.title}“ geändert: ${changes.join(', ')}`
		)
	]);
	return true;
}

/**
 * Makes an open task of the report, linked to its lease, and moves a new report to
 * "In Bearbeitung". Returns the existing task when the report already has one.
 */
export async function createTaskFromReport(
	db: Database,
	context: AuditContext,
	reportId: string
): Promise<{ ok: true; taskId: string } | { ok: false; reason: 'missing' }> {
	const { accountId } = context;
	const report = await getDamageReport(db, accountId, reportId);
	if (!report) return { ok: false, reason: 'missing' };
	if (report.taskId) return { ok: true, taskId: report.taskId };
	const note = [report.location && `Ort: ${report.location}`, report.description]
		.filter(Boolean)
		.join('\n\n');
	const created = await createTask(db, context, {
		title: `Schaden: ${report.title}`.slice(0, 200),
		dueDate: null,
		propertyId: null,
		leaseId: report.lease?.id ?? null,
		note: note.slice(0, 2000) || null
	});
	if (!created.ok) return { ok: false, reason: 'missing' };
	await db
		.update(damageReports)
		.set({
			taskId: created.id,
			status: report.status === 'new' ? 'in_progress' : report.status,
			updatedAt: new Date()
		})
		.where(and(eq(damageReports.accountId, accountId), eq(damageReports.id, reportId)));
	return { ok: true, taskId: created.id };
}

/** Deletes the report with its photos. False when the report is not in the account. */
export async function deleteDamageReport(
	db: Database,
	context: AuditContext,
	reportId: string,
	options?: StorageOptions
): Promise<boolean> {
	const { accountId } = context;
	const existing = await getDamageReport(db, accountId, reportId);
	if (!existing) return false;
	for (const photo of await listReportPhotos(db, accountId, reportId)) {
		await deleteDocument(db, context, photo.id, options);
	}
	await runBatch(db, [
		db
			.delete(damageReports)
			.where(and(eq(damageReports.accountId, accountId), eq(damageReports.id, reportId))),
		auditEntry(
			db,
			context,
			'damageReport',
			reportId,
			'delete',
			`Schadensmeldung „${existing.title}“ gelöscht`
		)
	]);
	return true;
}

/** The mail that tells the users of the account about a new report; `link` leads to it. */
export function damageReportMail(
	to: string,
	report: DamageReportInput,
	leaseLabel: string,
	link: string | undefined
): Mail {
	const lines = [
		'Hallo,\n',
		`über das Mieterportal von ${leaseLabel} ist eine Schadensmeldung eingegangen` +
			(report.urgent ? '. Die Mieter haben sie als dringend markiert.\n' : '.\n'),
		`${report.title}`,
		...(report.location ? [`Ort: ${report.location}`] : []),
		'',
		report.description,
		''
	];
	const reporter = [report.reporterName, report.reporterPhone].filter(Boolean).join(', ');
	if (reporter) lines.push(`Gemeldet von: ${reporter}`, '');
	if (link) lines.push(`Zur Meldung: ${link}`, '');
	return {
		to,
		subject: `${report.urgent ? 'Dringende ' : 'Neue '}Schadensmeldung: ${report.title}`,
		text: lines.join('\n')
	};
}
