import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or, gt } from 'drizzle-orm';
import { formatDate, today, type IsoDate } from '../dates';
import { storedMimeType } from '../domain/documents';
import { periodLabel } from '../domain/statement';
import {
	damageNote,
	MAX_OPEN_DAMAGE_REPORTS,
	MAX_OPEN_METER_REPORTS,
	portalOpenOn,
	portalOpenUntil
} from '../domain/tenant-portal';
import { formatNumber } from '../format';
import { landlordAddress } from './accounts';
import { auditEntry, type AuditContext } from './audit';
import { generateToken, hashToken } from './auth';
import type { Database } from './db';
import { runBatch } from './db/batch';
import {
	documents,
	meters,
	operatingCostStatements,
	statementResults,
	tasks,
	tenantMeterReports,
	tenantPortals
} from './db/schema';
import { getDocument, openDocument, storeDocument, type DocumentError } from './documents';
import { getLease, leaseLabel, type LeaseSummary } from './leases';
import { createReading, meterLabel } from './operating-costs/meters';
import { assertQuota } from './quotas';

// Mieterportal: one secret link per lease. Whoever has it sees the approved statements that
// reached the tenants and the documents the landlord shared, and may report meter readings and
// damage, without an account. The token is the only credential and only its hash is stored, so
// the landlord sees the link once; a new link replaces the old one. A reported reading waits
// for the landlord to take it over; a reported damage becomes a repair task at once.

/** A photo the tenant sends, as the form parsed it. */
export type PortalPhoto = { name: string; type: string; bytes: Uint8Array };

export type MeterReportInput = {
	meterId: string;
	readAt: IsoDate;
	value: number;
	note: string | null;
	photo: PortalPhoto | null;
};

export type DamageReportInput = {
	title: string;
	description: string;
	reporter: string;
	phone: string | null;
	photos: PortalPhoto[];
};

export type PortalRefusal =
	'unknown-meter' | 'future-date' | 'before-lease' | 'too-many' | 'not-a-photo' | DocumentError;

/** The portal a token opens: the lease and the account it belongs to. */
export type PortalAccess = { accountId: string; lease: LeaseSummary };

/** Writes through the portal have no user; the log says where they came from. */
const portalContext = (accountId: string): AuditContext => ({ accountId, userId: null });

/** When the link of the lease was created, or null when there is none. */
export async function portalLink(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<{ createdAt: Date } | null> {
	const [row] = await db
		.select({ createdAt: tenantPortals.createdAt })
		.from(tenantPortals)
		.where(and(eq(tenantPortals.accountId, accountId), eq(tenantPortals.leaseId, leaseId)));
	return row ?? null;
}

/** A new link for the lease; it replaces an earlier one, which stops working. */
export async function createPortalLink(
	db: Database,
	context: AuditContext,
	lease: Pick<LeaseSummary, 'id' | 'unit' | 'property'>
): Promise<{ token: string }> {
	const token = generateToken();
	const id = crypto.randomUUID();
	await runBatch(db, [
		db
			.delete(tenantPortals)
			.where(
				and(eq(tenantPortals.accountId, context.accountId), eq(tenantPortals.leaseId, lease.id))
			),
		db.insert(tenantPortals).values({
			id,
			accountId: context.accountId,
			leaseId: lease.id,
			tokenHash: await hashToken(token)
		}),
		auditEntry(
			db,
			context,
			'tenant_portal',
			id,
			'create',
			`Link zum Mieterportal für ${leaseLabel(lease)} erstellt`
		)
	]);
	return { token };
}

/** Stops the link of the lease; false when it had none. */
export async function revokePortalLink(
	db: Database,
	context: AuditContext,
	lease: Pick<LeaseSummary, 'id' | 'unit' | 'property'>
): Promise<boolean> {
	const deleted = await db
		.delete(tenantPortals)
		.where(and(eq(tenantPortals.accountId, context.accountId), eq(tenantPortals.leaseId, lease.id)))
		.returning({ id: tenantPortals.id });
	if (deleted.length === 0) return false;
	await auditEntry(
		db,
		context,
		'tenant_portal',
		deleted[0].id,
		'delete',
		`Link zum Mieterportal für ${leaseLabel(lease)} gesperrt`
	);
	return true;
}

/**
 * The lease a token opens, or undefined when the token is malformed or unknown, or the lease
 * ended more than PORTAL_MONTHS_AFTER_END months ago.
 */
export async function openPortal(
	db: Database,
	token: string,
	day: IsoDate = today()
): Promise<PortalAccess | undefined> {
	if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return undefined;
	const [row] = await db
		.select({ accountId: tenantPortals.accountId, leaseId: tenantPortals.leaseId })
		.from(tenantPortals)
		.where(eq(tenantPortals.tokenHash, await hashToken(token)));
	if (!row) return undefined;
	const lease = await getLease(db, row.accountId, row.leaseId);
	if (!lease || !portalOpenOn(lease.endDate, day)) return undefined;
	return { accountId: row.accountId, lease };
}

/** The meters of the lease's own units the tenants can read, not those of the building. */
async function portalMeters(db: Database, { accountId, lease }: PortalAccess, day: IsoDate) {
	const unitIds = [lease.unitId, ...lease.extraUnits.map((unit) => unit.id)];
	const rows = await db
		.select()
		.from(meters)
		.where(
			and(
				eq(meters.accountId, accountId),
				inArray(meters.unitId, unitIds),
				or(isNull(meters.removedAt), gt(meters.removedAt, day))
			)
		)
		.orderBy(asc(meters.kind), asc(meters.serialNumber), asc(meters.createdAt));
	const unitName = new Map([lease.unit, ...lease.extraUnits].map((unit) => [unit.id, unit.name]));
	return rows.map((meter) => ({
		id: meter.id,
		label: meterLabel(meter),
		unit: meter.unit,
		location: meter.location,
		unitName: lease.extraUnits.length > 0 ? (unitName.get(meter.unitId!) ?? null) : null
	}));
}

export type PortalStatement = {
	id: string;
	period: string;
	version: number;
	balance: number;
	deliveredOn: IsoDate;
};

export type PortalView = {
	unit: string;
	address: string;
	tenants: string[];
	landlord: Awaited<ReturnType<typeof landlordAddress>>;
	openUntil: IsoDate | null;
	statements: PortalStatement[];
	documents: { id: string; name: string; mimeType: string; size: number; createdAt: Date }[];
	meters: Awaited<ReturnType<typeof portalMeters>>;
	/** Readings the tenants sent that the landlord has not taken over yet. */
	pendingReadings: { id: string; meter: string; readAt: IsoDate; value: number; unit: string }[];
	/** The Schadensmeldungen of the lease, newest first, with whether they are done. */
	damages: { id: string; title: string; reportedAt: Date; done: boolean }[];
};

/** Everything the portal page shows; a fixed number of queries. */
export async function portalView(
	db: Database,
	access: PortalAccess,
	day: IsoDate = today()
): Promise<PortalView> {
	const { accountId, lease } = access;
	const [landlord, statementRows, documentRows, meterRows, pendingRows, damageRows] =
		await Promise.all([
			landlordAddress(db, accountId),
			db
				.select({
					id: statementResults.id,
					balance: statementResults.balance,
					deliveredOn: statementResults.deliveredOn,
					periodStart: operatingCostStatements.periodStart,
					periodEnd: operatingCostStatements.periodEnd,
					version: operatingCostStatements.version
				})
				.from(statementResults)
				.innerJoin(
					operatingCostStatements,
					eq(statementResults.statementId, operatingCostStatements.id)
				)
				.where(
					and(
						eq(statementResults.accountId, accountId),
						eq(statementResults.leaseId, lease.id),
						eq(operatingCostStatements.status, 'approved'),
						isNotNull(statementResults.deliveredOn)
					)
				)
				.orderBy(desc(operatingCostStatements.periodEnd), desc(operatingCostStatements.version)),
			db
				.select({
					id: documents.id,
					name: documents.name,
					mimeType: documents.mimeType,
					size: documents.size,
					createdAt: documents.createdAt
				})
				.from(documents)
				.where(
					and(
						eq(documents.accountId, accountId),
						eq(documents.leaseId, lease.id),
						eq(documents.sharedWithTenant, true)
					)
				)
				.orderBy(desc(documents.createdAt), asc(documents.name)),
			portalMeters(db, access, day),
			db
				.select({
					id: tenantMeterReports.id,
					readAt: tenantMeterReports.readAt,
					value: tenantMeterReports.value,
					meter: meters
				})
				.from(tenantMeterReports)
				.innerJoin(meters, eq(meters.id, tenantMeterReports.meterId))
				.where(
					and(eq(tenantMeterReports.accountId, accountId), eq(tenantMeterReports.leaseId, lease.id))
				)
				.orderBy(desc(tenantMeterReports.readAt), asc(tenantMeterReports.createdAt)),
			db
				.select({
					id: tasks.id,
					title: tasks.title,
					reportedAt: tasks.createdAt,
					done: tasks.done
				})
				.from(tasks)
				.where(
					and(
						eq(tasks.accountId, accountId),
						eq(tasks.leaseId, lease.id),
						eq(tasks.reportedByTenant, true)
					)
				)
				.orderBy(desc(tasks.createdAt))
		]);
	return {
		unit: [lease.unit, ...lease.extraUnits].map((unit) => unit.name).join(', '),
		address: `${lease.property.street}, ${lease.property.postalCode} ${lease.property.city}`,
		tenants: lease.tenants.map((tenant) => `${tenant.firstName} ${tenant.lastName}`),
		landlord,
		openUntil: portalOpenUntil(lease.endDate),
		statements: statementRows.map((row) => ({
			id: row.id,
			period: periodLabel(row.periodStart, row.periodEnd),
			version: row.version,
			balance: row.balance,
			deliveredOn: row.deliveredOn!
		})),
		documents: documentRows,
		meters: meterRows,
		pendingReadings: pendingRows.map((row) => ({
			id: row.id,
			meter: meterLabel(row.meter),
			readAt: row.readAt,
			value: row.value,
			unit: row.meter.unit
		})),
		damages: damageRows
	};
}

/** The statement and lease a portal statement prints from, if the portal may show it. */
export async function portalStatement(
	db: Database,
	{ accountId, lease }: PortalAccess,
	resultId: string
): Promise<{ statementId: string; leaseId: string } | undefined> {
	const [row] = await db
		.select({ statementId: statementResults.statementId })
		.from(statementResults)
		.innerJoin(
			operatingCostStatements,
			eq(statementResults.statementId, operatingCostStatements.id)
		)
		.where(
			and(
				eq(statementResults.accountId, accountId),
				eq(statementResults.id, resultId),
				eq(statementResults.leaseId, lease.id),
				eq(operatingCostStatements.status, 'approved'),
				isNotNull(statementResults.deliveredOn)
			)
		);
	return row ? { statementId: row.statementId, leaseId: lease.id } : undefined;
}

/** A document shared with the lease's tenants, with its bytes; undefined for any other. */
export async function openPortalDocument(
	db: Database,
	{ accountId, lease }: PortalAccess,
	documentId: string
) {
	const document = await getDocument(db, accountId, documentId);
	if (!document || document.leaseId !== lease.id || !document.sharedWithTenant) return undefined;
	return openDocument(db, accountId, documentId);
}

/** Only photos are taken: the types a browser shows, checked by their bytes, and HEIC. */
function isPhotoType(type: string): boolean {
	return ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(type);
}

const extensions: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/heic': 'heic',
	'image/heif': 'heif'
};

/** Stores a photo the tenant sent as a document of the lease. */
async function storePhoto(
	db: Database,
	{ accountId, lease }: PortalAccess,
	photo: PortalPhoto,
	name: string,
	links: { unitId?: string | null; taskId?: string | null }
): Promise<{ ok: true; id: string } | { ok: false; reason: DocumentError }> {
	const extension = extensions[photo.type] ?? 'jpg';
	return storeDocument(db, portalContext(accountId), {
		name: `${name}.${extension}`,
		mimeType: photo.type,
		bytes: photo.bytes,
		links: { propertyId: lease.property.id, leaseId: lease.id, ...links }
	});
}

/** A photo whose bytes are not those of a photo is refused before anything is stored. */
function photoTypesValid(photos: PortalPhoto[]): boolean {
	return photos.every((photo) => isPhotoType(storedMimeType(photo.type, photo.bytes)));
}

/**
 * Saves a Zählerstand the tenant reported, for the landlord to take over. The meter must be one
 * of the lease's units, the date neither in the future nor before the lease.
 */
export async function reportMeterReading(
	db: Database,
	access: PortalAccess,
	input: MeterReportInput,
	day: IsoDate = today()
): Promise<{ ok: true } | { ok: false; reason: PortalRefusal }> {
	const { accountId, lease } = access;
	const meter = (await portalMeters(db, access, day)).find((row) => row.id === input.meterId);
	if (!meter) return { ok: false, reason: 'unknown-meter' };
	if (input.readAt > day) return { ok: false, reason: 'future-date' };
	if (input.readAt < lease.startDate) return { ok: false, reason: 'before-lease' };
	const [open] = await db
		.select({ value: count() })
		.from(tenantMeterReports)
		.where(
			and(eq(tenantMeterReports.accountId, accountId), eq(tenantMeterReports.leaseId, lease.id))
		);
	if (open.value >= MAX_OPEN_METER_REPORTS) return { ok: false, reason: 'too-many' };
	if (input.photo && !photoTypesValid([input.photo])) {
		return { ok: false, reason: 'not-a-photo' };
	}
	let documentId: string | null = null;
	if (input.photo) {
		const stored = await storePhoto(
			db,
			access,
			input.photo,
			`Zählerfoto ${meter.label} ${formatDate(input.readAt)}`,
			{ unitId: (await meterUnit(db, input.meterId)) ?? null }
		);
		if (!stored.ok) return stored;
		documentId = stored.id;
	}
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(tenantMeterReports).values({
			id,
			accountId,
			leaseId: lease.id,
			meterId: input.meterId,
			readAt: input.readAt,
			value: input.value,
			note: input.note,
			documentId
		}),
		auditEntry(
			db,
			portalContext(accountId),
			'tenant_meter_report',
			id,
			'create',
			`Zählerstand ${formatNumber(input.value)} ${meter.unit} am ${formatDate(input.readAt)} für Zähler ${meter.label} über das Mieterportal gemeldet (${leaseLabel(lease)})`
		)
	]);
	return { ok: true };
}

async function meterUnit(db: Database, meterId: string): Promise<string | null> {
	const [row] = await db
		.select({ unitId: meters.unitId })
		.from(meters)
		.where(eq(meters.id, meterId));
	return row?.unitId ?? null;
}

/**
 * Turns a Schadensmeldung into an open repair task of the lease, with the photos as its
 * documents. The photos are stored after the task, so they can name it; one that cannot be
 * stored (the account's storage is full) leaves the task without it.
 */
export async function reportDamage(
	db: Database,
	access: PortalAccess,
	input: DamageReportInput,
	day: IsoDate = today()
): Promise<{ ok: true; photosStored: number } | { ok: false; reason: PortalRefusal }> {
	const { accountId, lease } = access;
	const [open] = await db
		.select({ value: count() })
		.from(tasks)
		.where(
			and(
				eq(tasks.accountId, accountId),
				eq(tasks.leaseId, lease.id),
				eq(tasks.reportedByTenant, true),
				eq(tasks.done, false)
			)
		);
	if (open.value >= MAX_OPEN_DAMAGE_REPORTS) return { ok: false, reason: 'too-many' };
	if (!photoTypesValid(input.photos)) return { ok: false, reason: 'not-a-photo' };
	await assertQuota(db, accountId, 'tasks');
	const id = crypto.randomUUID();
	const title = `Schaden: ${input.title}`;
	await runBatch(db, [
		db.insert(tasks).values({
			id,
			accountId,
			title,
			category: 'repair',
			dueDate: null,
			propertyId: lease.property.id,
			leaseId: lease.id,
			note: damageNote({
				description: input.description,
				reporter: input.reporter,
				phone: input.phone,
				reportedOn: formatDate(day)
			}),
			reportedByTenant: true
		}),
		auditEntry(
			db,
			portalContext(accountId),
			'task',
			id,
			'create',
			`Aufgabe „${title}“ über das Mieterportal gemeldet (${leaseLabel(lease)})`
		)
	]);
	let photosStored = 0;
	for (const [index, photo] of input.photos.entries()) {
		const suffix = input.photos.length > 1 ? ` ${index + 1}` : '';
		const stored = await storePhoto(db, access, photo, `Schadensfoto ${formatDate(day)}${suffix}`, {
			unitId: lease.unitId,
			taskId: id
		});
		if (stored.ok) photosStored++;
	}
	return { ok: true, photosStored };
}

// The landlord's side, on the lease's Mieterportal tab.

export type MeterReportRow = {
	id: string;
	meterId: string;
	meter: string;
	unit: string;
	readAt: IsoDate;
	value: number;
	note: string | null;
	documentId: string | null;
	createdAt: Date;
};

/** The readings the tenants of the lease reported and the landlord has not handled yet. */
export async function listMeterReports(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<MeterReportRow[]> {
	const rows = await db
		.select({ report: tenantMeterReports, meter: meters })
		.from(tenantMeterReports)
		.innerJoin(meters, eq(meters.id, tenantMeterReports.meterId))
		.where(
			and(eq(tenantMeterReports.accountId, accountId), eq(tenantMeterReports.leaseId, leaseId))
		)
		.orderBy(asc(tenantMeterReports.readAt), asc(tenantMeterReports.createdAt));
	return rows.map(({ report, meter }) => ({
		id: report.id,
		meterId: report.meterId,
		meter: meterLabel(meter),
		unit: meter.unit,
		readAt: report.readAt,
		value: report.value,
		note: report.note,
		documentId: report.documentId,
		createdAt: report.createdAt
	}));
}

/** The number of reported readings waiting, per lease, for the reminders on the start page. */
export async function countMeterReports(
	db: Database,
	accountId: string
): Promise<{ leaseId: string; count: number }[]> {
	return db
		.select({ leaseId: tenantMeterReports.leaseId, count: count() })
		.from(tenantMeterReports)
		.where(eq(tenantMeterReports.accountId, accountId))
		.groupBy(tenantMeterReports.leaseId);
}

async function meterReport(db: Database, accountId: string, leaseId: string, reportId: string) {
	const [row] = await db
		.select()
		.from(tenantMeterReports)
		.where(
			and(
				eq(tenantMeterReports.accountId, accountId),
				eq(tenantMeterReports.leaseId, leaseId),
				eq(tenantMeterReports.id, reportId)
			)
		);
	return row;
}

/**
 * Takes a reported reading over as the meter's Zählerstand and removes the report. Refused when
 * the meter has a reading on that day already.
 */
export async function acceptMeterReport(
	db: Database,
	context: AuditContext,
	leaseId: string,
	reportId: string
): Promise<'accepted' | 'missing' | 'duplicate-date'> {
	const report = await meterReport(db, context.accountId, leaseId, reportId);
	if (!report) return 'missing';
	const created = await createReading(db, context, report.meterId, {
		readAt: report.readAt,
		value: report.value,
		estimated: false,
		note: report.note ? `Vom Mieter gemeldet: ${report.note}` : 'Vom Mieter gemeldet'
	});
	if (!created.ok) return created.reason;
	await db
		.delete(tenantMeterReports)
		.where(
			and(eq(tenantMeterReports.accountId, context.accountId), eq(tenantMeterReports.id, reportId))
		);
	return 'accepted';
}

/** Drops a reported reading; its photo stays with the lease's documents. */
export async function discardMeterReport(
	db: Database,
	context: AuditContext,
	leaseId: string,
	reportId: string
): Promise<boolean> {
	const report = await meterReport(db, context.accountId, leaseId, reportId);
	if (!report) return false;
	await runBatch(db, [
		db
			.delete(tenantMeterReports)
			.where(
				and(
					eq(tenantMeterReports.accountId, context.accountId),
					eq(tenantMeterReports.id, reportId)
				)
			),
		auditEntry(
			db,
			context,
			'tenant_meter_report',
			reportId,
			'delete',
			`Gemeldeten Zählerstand ${formatNumber(report.value)} am ${formatDate(report.readAt)} verworfen`
		)
	]);
	return true;
}

/** Shows a document of the lease in its portal, or stops showing it; false when not the lease's. */
export async function setDocumentShared(
	db: Database,
	context: AuditContext,
	leaseId: string,
	documentId: string,
	shared: boolean
): Promise<boolean> {
	const document = await getDocument(db, context.accountId, documentId);
	if (!document || document.leaseId !== leaseId) return false;
	if (document.sharedWithTenant === shared) return true;
	await runBatch(db, [
		db
			.update(documents)
			.set({ sharedWithTenant: shared })
			.where(and(eq(documents.accountId, context.accountId), eq(documents.id, documentId))),
		auditEntry(
			db,
			context,
			'document',
			documentId,
			'update',
			shared
				? `Dokument ${document.name} im Mieterportal freigegeben`
				: `Dokument ${document.name} nicht mehr im Mieterportal gezeigt`
		)
	]);
	return true;
}

/** The Schadensmeldungen of the lease for its tab, newest first. */
export async function listDamageReports(db: Database, accountId: string, leaseId: string) {
	return db
		.select({ id: tasks.id, title: tasks.title, createdAt: tasks.createdAt, done: tasks.done })
		.from(tasks)
		.where(
			and(
				eq(tasks.accountId, accountId),
				eq(tasks.leaseId, leaseId),
				eq(tasks.reportedByTenant, true)
			)
		)
		.orderBy(desc(tasks.createdAt));
}
