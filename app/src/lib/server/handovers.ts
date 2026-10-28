import { and, eq, inArray } from 'drizzle-orm';
import { formatDate, today, type IsoDate } from '../dates';
import { protocolBlocks, protocolTitle, type HandoverContent } from '../domain/handover';
import { handoverKindLabels } from '../labels';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import {
	handoverProtocols,
	meterReadings,
	meters,
	type HandoverKey,
	type HandoverKind,
	type HandoverRoom
} from './db/schema';
import { getLease, leaseLabel } from './leases';
import { meterLabel } from './operating-costs/meters';
import type { Report } from './pdf';
import { assertQuota } from './quotas';
import { personName } from '../format';

// Übergabeprotokolle of a lease: one for the move-in and one for the move-out. Saving one stores
// its readings as Zählerstände on its date too, where the meter has none that day yet; deleting
// the protocol keeps them, as they were read all the same.

export type HandoverRow = typeof handoverProtocols.$inferSelect;

export type HandoverInput = {
	date: IsoDate;
	attendees: string | null;
	rooms: HandoverRoom[];
	keys: HandoverKey[];
	/** Values by meter id, for the meters of the lease's units. */
	readings: Record<string, number>;
	notes: string | null;
};

export type HandoverResult = { ok: true; id: string } | { ok: false; message: string };

/** The protocols of the lease by kind. */
export async function listHandovers(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<Partial<Record<HandoverKind, HandoverRow>>> {
	const rows = await db
		.select()
		.from(handoverProtocols)
		.where(and(eq(handoverProtocols.accountId, accountId), eq(handoverProtocols.leaseId, leaseId)));
	return Object.fromEntries(rows.map((row) => [row.kind, row]));
}

/** The meters of the lease's units in place on the day, for the readings of the protocol. */
export async function handoverMeters(
	db: Database,
	accountId: string,
	unitIds: string[],
	date: IsoDate
) {
	if (unitIds.length === 0) return [];
	const rows = await db
		.select()
		.from(meters)
		.where(and(eq(meters.accountId, accountId), inArray(meters.unitId, unitIds)));
	return rows.filter(
		(meter) =>
			(meter.installedAt === null || meter.installedAt <= date) &&
			(meter.removedAt === null || meter.removedAt >= date)
	);
}

/**
 * Creates or replaces the protocol of the kind. A move-in before the lease starts or a move-out
 * before the move-in is refused, as is a date in the future. Undefined when the lease is not in
 * the account.
 */
export async function saveHandover(
	db: Database,
	context: AuditContext,
	leaseId: string,
	kind: HandoverKind,
	input: HandoverInput
): Promise<HandoverResult | undefined> {
	const { accountId } = context;
	const lease = await getLease(db, accountId, leaseId);
	if (!lease) return undefined;
	if (input.date > today()) {
		return { ok: false, message: 'Das Protokoll kann nicht in der Zukunft liegen.' };
	}
	const existing = await listHandovers(db, accountId, leaseId);
	if (kind === 'move_out' && existing.move_in && input.date < existing.move_in.date) {
		return {
			ok: false,
			message: `Der Auszug kann nicht vor dem Einzug am ${formatDate(existing.move_in.date)} liegen.`
		};
	}
	if (kind === 'move_in' && existing.move_out && input.date > existing.move_out.date) {
		return {
			ok: false,
			message: `Der Einzug kann nicht nach dem Auszug am ${formatDate(existing.move_out.date)} liegen.`
		};
	}
	const unitIds = [lease.unitId, ...lease.extraUnits.map((unit) => unit.id)];
	const available = await handoverMeters(db, accountId, unitIds, input.date);
	const readings = available
		.filter((meter) => input.readings[meter.id] !== undefined)
		.map((meter) => ({
			meterId: meter.id,
			label: meterLabel(meter),
			value: input.readings[meter.id],
			unit: meter.unit
		}));
	if (readings.length > 0) await assertQuota(db, accountId, 'meterReadings', readings.length);

	const values = {
		date: input.date,
		attendees: input.attendees,
		rooms: input.rooms,
		keys: input.keys,
		readings,
		notes: input.notes
	};
	const previous = existing[kind];
	const id = previous?.id ?? crypto.randomUUID();
	const label = `Übergabeprotokoll ${handoverKindLabels[kind]} vom ${formatDate(input.date)}`;
	await runBatch(db, [
		previous
			? db
					.update(handoverProtocols)
					.set(values)
					.where(and(eq(handoverProtocols.accountId, accountId), eq(handoverProtocols.id, id)))
			: db.insert(handoverProtocols).values({ id, accountId, leaseId, kind, ...values }),
		...readings.map((reading) =>
			db
				.insert(meterReadings)
				.values({
					accountId,
					meterId: reading.meterId,
					readAt: input.date,
					value: reading.value,
					note: label
				})
				.onConflictDoNothing()
		),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			previous ? 'update' : 'create',
			`${label} ${previous ? 'geändert' : 'angelegt'}`
		)
	]);
	return { ok: true, id };
}

export async function deleteHandover(
	db: Database,
	context: AuditContext,
	leaseId: string,
	kind: HandoverKind
): Promise<boolean> {
	const protocol = (await listHandovers(db, context.accountId, leaseId))[kind];
	if (!protocol) return false;
	await runBatch(db, [
		db
			.delete(handoverProtocols)
			.where(
				and(
					eq(handoverProtocols.accountId, context.accountId),
					eq(handoverProtocols.id, protocol.id)
				)
			),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'delete',
			`Übergabeprotokoll ${handoverKindLabels[kind]} vom ${formatDate(protocol.date)} gelöscht`
		)
	]);
	return true;
}

/** The protocol as a report for renderReport; undefined when the lease has none of the kind. */
export async function handoverReport(
	db: Database,
	accountId: string,
	leaseId: string,
	kind: HandoverKind
): Promise<{ report: Report; filename: string } | undefined> {
	const protocols = await listHandovers(db, accountId, leaseId);
	const protocol = protocols[kind];
	if (!protocol) return undefined;
	const lease = await getLease(db, accountId, leaseId);
	if (!lease) return undefined;
	const tenants = lease.tenants.map(personName).join(', ');
	const content: HandoverContent = protocol;
	const report: Report = {
		title: protocolTitle(kind),
		subtitle: [
			leaseLabel(lease),
			...(tenants ? [`Mieter: ${tenants}`] : []),
			`Übergabe am ${formatDate(protocol.date)}`,
			...(protocol.attendees ? [`Anwesend: ${protocol.attendees}`] : [])
		],
		blocks: protocolBlocks(content, protocols.move_in)
	};
	const names = lease.tenants.map((tenant) => tenant.lastName).join(', ') || lease.unit.name;
	return {
		report,
		filename: `${protocolTitle(kind)} ${names} ${formatDate(protocol.date)}.pdf`
	};
}
