import { and, asc, eq, inArray } from 'drizzle-orm';
import { auditEntry, type AuditContext } from '../audit';
import type { Database } from '../db';
import { chunk, chunkIds, rowsPerStatement, runBatch } from '../db/batch';
import { billingCircleUnits, billingCircles, properties, units } from '../db/schema';

// Abrechnungskreise: the subset of a property's units that shares a cost, e.g. the parking
// spaces that pay nothing towards the staircase, or one of several entrances. A cost item
// without a circle is shared by every unit of the property.

export type BillingCircle = typeof billingCircles.$inferSelect;

export type BillingCircleInput = { name: string; unitIds: string[] };

export type BillingCircleWithUnits = BillingCircle & {
	propertyName: string;
	unitIds: string[];
};

export type CircleError = 'missing' | 'unknown-property' | 'unknown-unit';

async function decorate(
	db: Database,
	accountId: string,
	rows: (BillingCircle & { propertyName: string })[]
): Promise<BillingCircleWithUnits[]> {
	if (rows.length === 0) return [];
	const unitsByCircle = new Map<string, string[]>();
	for (const ids of chunkIds(rows.map((row) => row.id))) {
		const links = await db
			.select({ circleId: billingCircleUnits.circleId, unitId: billingCircleUnits.unitId })
			.from(billingCircleUnits)
			.innerJoin(units, eq(units.id, billingCircleUnits.unitId))
			.where(
				and(eq(billingCircleUnits.accountId, accountId), inArray(billingCircleUnits.circleId, ids))
			)
			.orderBy(asc(units.name));
		for (const link of links) {
			unitsByCircle.set(link.circleId, [...(unitsByCircle.get(link.circleId) ?? []), link.unitId]);
		}
	}
	return rows.map((row) => ({ ...row, unitIds: unitsByCircle.get(row.id) ?? [] }));
}

function query(db: Database, accountId: string, filter: { propertyId?: string; id?: string }) {
	const conditions = [eq(billingCircles.accountId, accountId)];
	if (filter.propertyId) conditions.push(eq(billingCircles.propertyId, filter.propertyId));
	if (filter.id) conditions.push(eq(billingCircles.id, filter.id));
	return db
		.select({
			id: billingCircles.id,
			accountId: billingCircles.accountId,
			propertyId: billingCircles.propertyId,
			name: billingCircles.name,
			createdAt: billingCircles.createdAt,
			propertyName: properties.name
		})
		.from(billingCircles)
		.innerJoin(properties, eq(properties.id, billingCircles.propertyId))
		.where(and(...conditions))
		.orderBy(asc(properties.name), asc(billingCircles.name), asc(billingCircles.createdAt));
}

/** The circles of the account, or of one property, with their units. Two queries. */
export async function listCircles(
	db: Database,
	accountId: string,
	propertyId?: string
): Promise<BillingCircleWithUnits[]> {
	return decorate(db, accountId, await query(db, accountId, { propertyId }));
}

export async function getCircle(
	db: Database,
	accountId: string,
	circleId: string
): Promise<BillingCircleWithUnits | undefined> {
	const [circle] = await decorate(db, accountId, await query(db, accountId, { id: circleId }));
	return circle;
}

/** Whether every unit belongs to the property of the account. */
async function unitsBelong(
	db: Database,
	accountId: string,
	propertyId: string,
	unitIds: string[]
): Promise<boolean> {
	let own = 0;
	for (const ids of chunkIds(unitIds)) {
		const rows = await db
			.select({ id: units.id })
			.from(units)
			.where(
				and(
					eq(units.accountId, accountId),
					eq(units.propertyId, propertyId),
					inArray(units.id, ids)
				)
			);
		own += rows.length;
	}
	return own === unitIds.length;
}

function unitInserts(db: Database, accountId: string, circleId: string, unitIds: string[]) {
	return chunk(unitIds, rowsPerStatement(billingCircleUnits)).map((ids) =>
		db.insert(billingCircleUnits).values(ids.map((unitId) => ({ accountId, circleId, unitId })))
	);
}

export async function createCircle(
	db: Database,
	context: AuditContext,
	propertyId: string,
	input: BillingCircleInput
): Promise<{ ok: true; id: string } | { ok: false; reason: CircleError }> {
	const { accountId } = context;
	const [property] = await db
		.select({ id: properties.id })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	if (!property) return { ok: false, reason: 'unknown-property' };
	const unitIds = [...new Set(input.unitIds)];
	if (!(await unitsBelong(db, accountId, propertyId, unitIds))) {
		return { ok: false, reason: 'unknown-unit' };
	}
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(billingCircles).values({ id, accountId, propertyId, name: input.name }),
		...unitInserts(db, accountId, id, unitIds),
		auditEntry(
			db,
			context,
			'billing_circle',
			id,
			'create',
			`Abrechnungskreis ${input.name} angelegt`
		)
	]);
	return { ok: true, id };
}

/** Replaces the name and the units of the circle in one batch. */
export async function updateCircle(
	db: Database,
	context: AuditContext,
	circleId: string,
	input: BillingCircleInput
): Promise<{ ok: true } | { ok: false; reason: CircleError }> {
	const { accountId } = context;
	const existing = await getCircle(db, accountId, circleId);
	if (!existing) return { ok: false, reason: 'missing' };
	const unitIds = [...new Set(input.unitIds)];
	if (!(await unitsBelong(db, accountId, existing.propertyId, unitIds))) {
		return { ok: false, reason: 'unknown-unit' };
	}
	await runBatch(db, [
		db
			.update(billingCircles)
			.set({ name: input.name })
			.where(and(eq(billingCircles.accountId, accountId), eq(billingCircles.id, circleId))),
		db.delete(billingCircleUnits).where(eq(billingCircleUnits.circleId, circleId)),
		...unitInserts(db, accountId, circleId, unitIds),
		auditEntry(
			db,
			context,
			'billing_circle',
			circleId,
			'update',
			`Abrechnungskreis ${input.name} geändert`
		)
	]);
	return { ok: true };
}

/**
 * Deletes the circle. Cost items and categories that named it fall back to all units of the
 * property (the columns are set to null by the schema).
 */
export async function deleteCircle(
	db: Database,
	context: AuditContext,
	circleId: string
): Promise<'deleted' | 'missing'> {
	const { accountId } = context;
	const existing = await getCircle(db, accountId, circleId);
	if (!existing) return 'missing';
	await runBatch(db, [
		db
			.delete(billingCircles)
			.where(and(eq(billingCircles.accountId, accountId), eq(billingCircles.id, circleId))),
		auditEntry(
			db,
			context,
			'billing_circle',
			circleId,
			'delete',
			`Abrechnungskreis ${existing.name} gelöscht`
		)
	]);
	return 'deleted';
}
