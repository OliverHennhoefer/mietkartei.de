import { and, asc, count, desc, eq, getTableColumns, max } from 'drizzle-orm';
import { auditEntry, type AuditContext } from '../audit';
import type { Database } from '../db';
import { runBatch } from '../db/batch';
import { meterReadings, meters, properties, units, type MeterKind } from '../db/schema';
import { assertQuota } from '../quotas';
import { formatDate } from '../../dates';
import { formatNumber } from '../../format';
import { meterKindLabels } from '../../labels';

// Zähler and Zählerstände: a meter belongs to the building (unitId null) or to one unit, lives
// from installedAt to removedAt and has readings on dates. Consumption is computed by the
// statement feature from the readings; this file only keeps them.

export type Meter = typeof meters.$inferSelect;
export type MeterReading = typeof meterReadings.$inferSelect;

export type MeterInput = {
	unitId: string | null;
	kind: MeterKind;
	serialNumber: string | null;
	unit: string;
	location: string | null;
	installedAt: string | null;
};

export type ReadingInput = {
	readAt: string;
	value: number;
	estimated: boolean;
	note: string | null;
};

export type MeterWithLastReading = Meter & {
	unitName: string | null;
	lastReading: Pick<MeterReading, 'id' | 'readAt' | 'value' | 'estimated'> | null;
};

export type MeterError = 'unknown-property' | 'unknown-unit';

/** What a meter is called in the audit log and on the page: kind and serial number. */
export function meterLabel(meter: Pick<Meter, 'kind' | 'serialNumber'>): string {
	const kind = meterKindLabels[meter.kind];
	return meter.serialNumber ? `${kind} ${meter.serialNumber}` : kind;
}

function query(db: Database, accountId: string, filter: { propertyId?: string; id?: string }) {
	const conditions = [eq(meters.accountId, accountId)];
	if (filter.propertyId) conditions.push(eq(meters.propertyId, filter.propertyId));
	if (filter.id) conditions.push(eq(meters.id, filter.id));
	return db
		.select({ ...getTableColumns(meters), unitName: units.name })
		.from(meters)
		.leftJoin(units, eq(units.id, meters.unitId))
		.where(and(...conditions))
		.orderBy(asc(units.name), asc(meters.kind), asc(meters.installedAt), asc(meters.createdAt));
}

/** The latest reading of every meter of the property, in one query. */
async function lastReadings(
	db: Database,
	accountId: string,
	propertyId: string
): Promise<Map<string, MeterWithLastReading['lastReading']>> {
	const latest = db
		.select({
			meterId: meterReadings.meterId,
			readAt: max(meterReadings.readAt).as('last_read_at')
		})
		.from(meterReadings)
		.where(eq(meterReadings.accountId, accountId))
		.groupBy(meterReadings.meterId)
		.as('latest');
	const rows = await db
		.select({
			id: meterReadings.id,
			meterId: meterReadings.meterId,
			readAt: meterReadings.readAt,
			value: meterReadings.value,
			estimated: meterReadings.estimated
		})
		.from(meterReadings)
		.innerJoin(
			latest,
			and(eq(meterReadings.meterId, latest.meterId), eq(meterReadings.readAt, latest.readAt))
		)
		.innerJoin(meters, eq(meters.id, meterReadings.meterId))
		.where(and(eq(meterReadings.accountId, accountId), eq(meters.propertyId, propertyId)));
	return new Map(rows.map(({ meterId, ...reading }) => [meterId, reading]));
}

/** The meters of the property, building meters first, each with its latest reading. */
export async function listMeters(
	db: Database,
	accountId: string,
	propertyId: string
): Promise<MeterWithLastReading[]> {
	const rows = await query(db, accountId, { propertyId });
	if (rows.length === 0) return [];
	const latest = await lastReadings(db, accountId, propertyId);
	const decorated = rows.map((row) => ({ ...row, lastReading: latest.get(row.id) ?? null }));
	// Building meters (no unit) before the units; the query sorted the units by name.
	return [
		...decorated.filter((meter) => meter.unitId === null),
		...decorated.filter((meter) => meter.unitId !== null)
	];
}

export async function getMeter(
	db: Database,
	accountId: string,
	meterId: string
): Promise<(Meter & { unitName: string | null }) | undefined> {
	const [meter] = await query(db, accountId, { id: meterId });
	return meter;
}

/** Whether the property is the account's and the unit, when given, is one of its units. */
async function checkPlace(
	db: Database,
	accountId: string,
	propertyId: string,
	unitId: string | null
): Promise<MeterError | undefined> {
	const [property] = await db
		.select({ id: properties.id })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	if (!property) return 'unknown-property';
	if (unitId) {
		const [unit] = await db
			.select({ id: units.id })
			.from(units)
			.where(
				and(eq(units.accountId, accountId), eq(units.propertyId, propertyId), eq(units.id, unitId))
			);
		if (!unit) return 'unknown-unit';
	}
	return undefined;
}

export async function createMeter(
	db: Database,
	context: AuditContext,
	propertyId: string,
	input: MeterInput
): Promise<{ ok: true; id: string } | { ok: false; reason: MeterError }> {
	const { accountId } = context;
	await assertQuota(db, accountId, 'meters');
	const reason = await checkPlace(db, accountId, propertyId, input.unitId);
	if (reason) return { ok: false, reason };
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(meters).values({ id, accountId, propertyId, ...input, removedAt: null }),
		auditEntry(db, context, 'meter', id, 'create', `Zähler ${meterLabel(input)} angelegt`)
	]);
	return { ok: true, id };
}

/**
 * Closes the meter on the given date ("Zähler ausbauen"); a new meter takes over from there. A
 * date before the installation is refused: the meter would have no lifetime left.
 */
export async function removeMeter(
	db: Database,
	context: AuditContext,
	meterId: string,
	removedAt: string
): Promise<'updated' | 'missing' | 'before-installation'> {
	const { accountId } = context;
	const existing = await getMeter(db, accountId, meterId);
	if (!existing) return 'missing';
	if (existing.installedAt && removedAt < existing.installedAt) return 'before-installation';
	await runBatch(db, [
		db
			.update(meters)
			.set({ removedAt })
			.where(and(eq(meters.accountId, accountId), eq(meters.id, meterId))),
		auditEntry(
			db,
			context,
			'meter',
			meterId,
			'update',
			`Zähler ${meterLabel(existing)} am ${formatDate(removedAt)} ausgebaut`
		)
	]);
	return 'updated';
}

/** Deletes the meter with all its readings (the schema cascades). */
export async function deleteMeter(
	db: Database,
	context: AuditContext,
	meterId: string
): Promise<'deleted' | 'missing'> {
	const { accountId } = context;
	const existing = await getMeter(db, accountId, meterId);
	if (!existing) return 'missing';
	const [{ readings }] = await db
		.select({ readings: count() })
		.from(meterReadings)
		.where(eq(meterReadings.meterId, meterId));
	await runBatch(db, [
		db.delete(meters).where(and(eq(meters.accountId, accountId), eq(meters.id, meterId))),
		auditEntry(
			db,
			context,
			'meter',
			meterId,
			'delete',
			`Zähler ${meterLabel(existing)} mit ${readings} Zählerständen gelöscht`
		)
	]);
	return 'deleted';
}

/** The readings of a meter of the account, newest first. */
export async function listReadings(
	db: Database,
	accountId: string,
	meterId: string
): Promise<MeterReading[]> {
	return db
		.select()
		.from(meterReadings)
		.where(and(eq(meterReadings.accountId, accountId), eq(meterReadings.meterId, meterId)))
		.orderBy(desc(meterReadings.readAt));
}

/** One reading per meter and day: a second one on the same date is refused, not overwritten. */
export async function createReading(
	db: Database,
	context: AuditContext,
	meterId: string,
	input: ReadingInput
): Promise<{ ok: true; id: string } | { ok: false; reason: 'missing' | 'duplicate-date' }> {
	const { accountId } = context;
	await assertQuota(db, accountId, 'meterReadings');
	const meter = await getMeter(db, accountId, meterId);
	if (!meter) return { ok: false, reason: 'missing' };
	const [taken] = await db
		.select({ id: meterReadings.id })
		.from(meterReadings)
		.where(and(eq(meterReadings.meterId, meterId), eq(meterReadings.readAt, input.readAt)));
	if (taken) return { ok: false, reason: 'duplicate-date' };
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(meterReadings).values({ id, accountId, meterId, ...input }),
		auditEntry(
			db,
			context,
			'meter_reading',
			id,
			'create',
			`Zählerstand ${formatNumber(input.value)} ${meter.unit} am ${formatDate(input.readAt)} für Zähler ${meterLabel(meter)} erfasst${input.estimated ? ' (geschätzt)' : ''}`
		)
	]);
	return { ok: true, id };
}

/** Changes a reading of the given meter; another reading on the new date is refused. */
export async function updateReading(
	db: Database,
	context: AuditContext,
	meterId: string,
	readingId: string,
	input: ReadingInput
): Promise<{ ok: true } | { ok: false; reason: 'missing' | 'duplicate-date' }> {
	const { accountId } = context;
	const ofMeter = and(
		eq(meterReadings.accountId, accountId),
		eq(meterReadings.meterId, meterId),
		eq(meterReadings.id, readingId)
	);
	const [existing] = await db
		.select({ meter: meters })
		.from(meterReadings)
		.innerJoin(meters, eq(meters.id, meterReadings.meterId))
		.where(ofMeter);
	if (!existing) return { ok: false, reason: 'missing' };
	const [taken] = await db
		.select({ id: meterReadings.id })
		.from(meterReadings)
		.where(and(eq(meterReadings.meterId, meterId), eq(meterReadings.readAt, input.readAt)));
	if (taken && taken.id !== readingId) return { ok: false, reason: 'duplicate-date' };
	await runBatch(db, [
		db.update(meterReadings).set(input).where(ofMeter),
		auditEntry(
			db,
			context,
			'meter_reading',
			readingId,
			'update',
			`Zählerstand ${formatNumber(input.value)} ${existing.meter.unit} am ${formatDate(input.readAt)} für Zähler ${meterLabel(existing.meter)} geändert${input.estimated ? ' (geschätzt)' : ''}`
		)
	]);
	return { ok: true };
}

/** Deletes a reading of the given meter; a reading of another meter counts as missing. */
export async function deleteReading(
	db: Database,
	context: AuditContext,
	meterId: string,
	readingId: string
): Promise<'deleted' | 'missing'> {
	const { accountId } = context;
	const ofMeter = and(
		eq(meterReadings.accountId, accountId),
		eq(meterReadings.meterId, meterId),
		eq(meterReadings.id, readingId)
	);
	const [existing] = await db
		.select({ reading: meterReadings, meter: meters })
		.from(meterReadings)
		.innerJoin(meters, eq(meters.id, meterReadings.meterId))
		.where(ofMeter);
	if (!existing) return 'missing';
	await runBatch(db, [
		db.delete(meterReadings).where(ofMeter),
		auditEntry(
			db,
			context,
			'meter_reading',
			readingId,
			'delete',
			`Zählerstand vom ${formatDate(existing.reading.readAt)} für Zähler ${meterLabel(existing.meter)} gelöscht`
		)
	]);
	return 'deleted';
}
