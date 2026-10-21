import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import type { Database } from './db';
import { leaseTenants, leases, properties, tenants, units } from './db/schema';
import type { PropertyInput, UnitInput } from '../validation';
import type { AuditContext } from './audit';
import { auditEntry } from './audit';
import { chunkIds, runBatch } from './db/batch';

// All queries take the account explicitly, so data of one account can never leak into another.
// Changes write their audit line in the same batch as the change itself.

export type Property = typeof properties.$inferSelect;
export type Unit = typeof units.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;

export async function listProperties(db: Database, accountId: string) {
	return db
		.select()
		.from(properties)
		.where(eq(properties.accountId, accountId))
		.orderBy(asc(properties.name), asc(properties.createdAt));
}

export async function getProperty(db: Database, accountId: string, propertyId: string) {
	const [property] = await db
		.select()
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	return property;
}

export async function listUnits(db: Database, accountId: string, propertyId: string) {
	return db
		.select()
		.from(units)
		.where(and(eq(units.accountId, accountId), eq(units.propertyId, propertyId)))
		.orderBy(asc(units.name), asc(units.createdAt));
}

function propertyLabel(property: { name: string }): string {
	return `Objekt ${property.name}`;
}

function unitLabel(unit: { name: string }, property: { name: string }): string {
	return `Einheit ${unit.name} in ${property.name}`;
}

/** Creates the property and its audit line atomically; returns the new id. */
export async function addProperty(
	db: Database,
	context: AuditContext,
	input: PropertyInput
): Promise<{ id: string }> {
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(properties).values({ ...input, id, accountId: context.accountId }),
		auditEntry(db, context, 'property', id, 'create', `${propertyLabel(input)} angelegt`)
	]);
	return { id };
}

/** Updates every field of the property; false when it does not exist in this account. */
export async function updateProperty(
	db: Database,
	context: AuditContext,
	propertyId: string,
	input: PropertyInput
): Promise<boolean> {
	const existing = await getProperty(db, context.accountId, propertyId);
	if (!existing) return false;
	await runBatch(db, [
		db
			.update(properties)
			.set(input)
			.where(and(eq(properties.accountId, context.accountId), eq(properties.id, propertyId))),
		auditEntry(db, context, 'property', propertyId, 'update', `${propertyLabel(input)} geändert`)
	]);
	return true;
}

/** Whether any lease, running or ended, uses one of the units. */
async function unitsInUse(db: Database, accountId: string, unitIds: string[]): Promise<boolean> {
	for (const ids of chunkIds(unitIds)) {
		const [lease] = await db
			.select({ id: leases.id })
			.from(leases)
			.where(and(eq(leases.accountId, accountId), inArray(leases.unitId, ids)))
			.limit(1);
		if (lease) return true;
	}
	return false;
}

/**
 * Deletes the property with its units (database cascade). Refused with 'in-use' while a lease
 * references one of its units, because the lease and its history must stay.
 */
export async function deleteProperty(
	db: Database,
	context: AuditContext,
	propertyId: string
): Promise<'deleted' | 'in-use' | 'missing'> {
	const { accountId } = context;
	const existing = await getProperty(db, accountId, propertyId);
	if (!existing) return 'missing';
	const ownUnits = await listUnits(db, accountId, propertyId);
	if (
		await unitsInUse(
			db,
			accountId,
			ownUnits.map((unit) => unit.id)
		)
	)
		return 'in-use';
	await runBatch(db, [
		db
			.delete(properties)
			.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId))),
		auditEntry(db, context, 'property', propertyId, 'delete', `${propertyLabel(existing)} gelöscht`)
	]);
	return 'deleted';
}

export async function getUnit(
	db: Database,
	accountId: string,
	unitId: string
): Promise<Unit | undefined> {
	const [unit] = await db
		.select()
		.from(units)
		.where(and(eq(units.accountId, accountId), eq(units.id, unitId)));
	return unit;
}

/** Creates the unit and its audit line atomically; undefined when the property is not in this account. */
export async function addUnit(
	db: Database,
	context: AuditContext,
	propertyId: string,
	input: UnitInput
): Promise<{ id: string } | undefined> {
	const property = await getProperty(db, context.accountId, propertyId);
	if (!property) return undefined;
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(units).values({ ...input, id, accountId: context.accountId, propertyId }),
		auditEntry(db, context, 'unit', id, 'create', `${unitLabel(input, property)} angelegt`)
	]);
	return { id };
}

/** Updates the unit's fields (never its property); false when it does not exist in this account. */
export async function updateUnit(
	db: Database,
	context: AuditContext,
	unitId: string,
	input: UnitInput
): Promise<boolean> {
	const { accountId } = context;
	const existing = await getUnit(db, accountId, unitId);
	if (!existing) return false;
	const property = await getProperty(db, accountId, existing.propertyId);
	if (!property) return false;
	await runBatch(db, [
		db
			.update(units)
			.set(input)
			.where(and(eq(units.accountId, accountId), eq(units.id, unitId))),
		auditEntry(db, context, 'unit', unitId, 'update', `${unitLabel(input, property)} geändert`)
	]);
	return true;
}

/** Deletes the unit. Refused with 'in-use' while a lease, running or ended, references it. */
export async function deleteUnit(
	db: Database,
	context: AuditContext,
	unitId: string
): Promise<'deleted' | 'in-use' | 'missing'> {
	const { accountId } = context;
	const existing = await getUnit(db, accountId, unitId);
	if (!existing) return 'missing';
	const property = await getProperty(db, accountId, existing.propertyId);
	if (!property) return 'missing';
	if (await unitsInUse(db, accountId, [unitId])) return 'in-use';
	await runBatch(db, [
		db.delete(units).where(and(eq(units.accountId, accountId), eq(units.id, unitId))),
		auditEntry(db, context, 'unit', unitId, 'delete', `${unitLabel(existing, property)} gelöscht`)
	]);
	return 'deleted';
}

/** The tenants of each lease, sorted by name; one query per 90 leases. */
async function tenantsOfLeases(
	db: Database,
	accountId: string,
	leaseIds: string[]
): Promise<Map<string, Tenant[]>> {
	const byLease = new Map<string, Tenant[]>(leaseIds.map((id) => [id, []]));
	for (const ids of chunkIds(leaseIds)) {
		const rows = await db
			.select({ leaseId: leaseTenants.leaseId, tenant: tenants })
			.from(leaseTenants)
			.innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
			.where(and(eq(tenants.accountId, accountId), inArray(leaseTenants.leaseId, ids)))
			.orderBy(asc(tenants.lastName), asc(tenants.firstName));
		for (const row of rows) byLease.get(row.leaseId)?.push(row.tenant);
	}
	return byLease;
}

/** A lease on a unit, running, upcoming or ended on the date, with its tenants. */
export type UnitLease = {
	id: string;
	unitId: string;
	unitName: string;
	startDate: string;
	endDate: string | null;
	/** Runs on the date. */
	active: boolean;
	/** Starts after the date; a lease neither active nor upcoming has ended. */
	upcoming: boolean;
	tenants: Tenant[];
};

/** Every lease on one unit or on the units of a property, newest first. */
export async function listUnitLeases(
	db: Database,
	accountId: string,
	on: { unitId: string } | { propertyId: string },
	date: string
): Promise<UnitLease[]> {
	const rows = await db
		.select({
			id: leases.id,
			unitId: leases.unitId,
			unitName: units.name,
			startDate: leases.startDate,
			endDate: leases.endDate
		})
		.from(leases)
		.innerJoin(units, eq(leases.unitId, units.id))
		.where(
			and(
				eq(leases.accountId, accountId),
				'unitId' in on ? eq(units.id, on.unitId) : eq(units.propertyId, on.propertyId)
			)
		)
		.orderBy(desc(leases.startDate));
	const tenantsOf = await tenantsOfLeases(
		db,
		accountId,
		rows.map((row) => row.id)
	);
	return rows.map((row) => ({
		...row,
		active: row.startDate <= date && (row.endDate === null || row.endDate >= date),
		upcoming: row.startDate > date,
		tenants: tenantsOf.get(row.id) ?? []
	}));
}

/** A lease active on the given date that occupies a unit, with its tenants. */
export type Occupancy = {
	leaseId: string;
	startDate: string;
	endDate: string | null;
	tenants: Tenant[];
};

export type UnitWithOccupancy = Unit & { occupancies: Occupancy[] };

/** Leases of the account that run on the date. */
function activeLeases(db: Database, accountId: string, date: string) {
	return db
		.select({
			id: leases.id,
			unitId: leases.unitId,
			startDate: leases.startDate,
			endDate: leases.endDate
		})
		.from(leases)
		.where(
			and(
				eq(leases.accountId, accountId),
				lte(leases.startDate, date),
				or(isNull(leases.endDate), gte(leases.endDate, date))
			)
		);
}

/** The units of the property with the leases occupying each one on the date and their tenants. */
export async function unitsWithOccupancy(
	db: Database,
	accountId: string,
	propertyId: string,
	date: string
): Promise<UnitWithOccupancy[]> {
	const [ownUnits, active] = await Promise.all([
		listUnits(db, accountId, propertyId),
		activeLeases(db, accountId, date)
	]);
	const unitIds = new Set(ownUnits.map((unit) => unit.id));
	const own = active
		.filter((lease) => unitIds.has(lease.unitId))
		.sort((a, b) => a.startDate.localeCompare(b.startDate));
	const tenantsOf = await tenantsOfLeases(
		db,
		accountId,
		own.map((lease) => lease.id)
	);

	return ownUnits.map((unit) => ({
		...unit,
		occupancies: own
			.filter((lease) => lease.unitId === unit.id)
			.map((lease) => ({
				leaseId: lease.id,
				startDate: lease.startDate,
				endDate: lease.endDate,
				tenants: tenantsOf.get(lease.id) ?? []
			}))
	}));
}

export type PropertyOverview = Property & {
	unitCount: number;
	/** Leases running on the date whose unit is in the property. */
	activeLeases: number;
	/** Units no running lease occupies. */
	vacantUnits: number;
};

/** Every property of the account with its unit, lease and vacancy counts on the date; three queries. */
export async function propertyOverview(
	db: Database,
	accountId: string,
	date: string
): Promise<PropertyOverview[]> {
	const [rows, allUnits, active] = await Promise.all([
		listProperties(db, accountId),
		db
			.select({ id: units.id, propertyId: units.propertyId })
			.from(units)
			.where(eq(units.accountId, accountId)),
		activeLeases(db, accountId, date)
	]);
	const occupied = new Set<string>(active.map((lease) => lease.unitId));
	const propertyOfUnit = new Map(allUnits.map((unit) => [unit.id, unit.propertyId]));

	return rows.map((property) => {
		const ownUnits = allUnits.filter((unit) => unit.propertyId === property.id);
		return {
			...property,
			unitCount: ownUnits.length,
			activeLeases: active.filter((lease) => propertyOfUnit.get(lease.unitId) === property.id)
				.length,
			vacantUnits: ownUnits.filter((unit) => !occupied.has(unit.id)).length
		};
	});
}
