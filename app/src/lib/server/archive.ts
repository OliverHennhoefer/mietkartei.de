import { and, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { formatDate, type IsoDate } from '../dates';
import { personName } from '../format';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { chunkIds, runBatch } from './db/batch';
import { leaseTenants, leaseUnits, leases, properties, tenants, units } from './db/schema';
import { leaseLinks, type DeletionLink } from './deletion';

// Archiving a sold property or a tenant who moved out: the record leaves lists and selects, and
// no new lease can name it, while its leases, ledger, statements and documents stay as they are.
// Only what no lease still runs on (or starts later) is archived; restoring is always possible.

export type ArchiveCheck = {
	archivedAt: IsoDate | null;
	/** Leases running on the date or starting later; they keep the record in use. */
	runningLeases: DeletionLink[];
};

/** Leases that have not ended before the date: no end yet, or an end on or after it. */
const notEnded = (date: IsoDate) => or(isNull(leases.endDate), gte(leases.endDate, date));

async function runningLeasesOnUnits(
	db: Database,
	accountId: string,
	unitIds: string[],
	date: IsoDate
): Promise<string[]> {
	const ids = new Set<string>();
	for (const group of chunkIds(unitIds)) {
		const [main, extra] = await Promise.all([
			db
				.select({ id: leases.id })
				.from(leases)
				.where(and(eq(leases.accountId, accountId), inArray(leases.unitId, group), notEnded(date))),
			db
				.select({ id: leases.id })
				.from(leaseUnits)
				.innerJoin(leases, eq(leases.id, leaseUnits.leaseId))
				.where(
					and(eq(leases.accountId, accountId), inArray(leaseUnits.unitId, group), notEnded(date))
				)
		]);
		for (const row of [...main, ...extra]) ids.add(row.id);
	}
	return [...ids];
}

// Properties

export async function propertyArchiving(
	db: Database,
	accountId: string,
	propertyId: string,
	date: IsoDate
): Promise<ArchiveCheck | undefined> {
	const [property] = await db
		.select({ archivedAt: properties.archivedAt })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	if (!property) return undefined;
	const unitRows = await db
		.select({ id: units.id })
		.from(units)
		.where(and(eq(units.accountId, accountId), eq(units.propertyId, propertyId)));
	const running = await runningLeasesOnUnits(
		db,
		accountId,
		unitRows.map((row) => row.id),
		date
	);
	return {
		archivedAt: property.archivedAt,
		runningLeases: await leaseLinks(db, accountId, running)
	};
}

/** Archives the property on the date; refused while a lease on its units has not ended. */
export async function archiveProperty(
	db: Database,
	context: AuditContext,
	propertyId: string,
	date: IsoDate
): Promise<'archived' | 'in-use' | 'missing'> {
	const { accountId } = context;
	const check = await propertyArchiving(db, accountId, propertyId, date);
	if (!check) return 'missing';
	if (check.archivedAt) return 'archived';
	if (check.runningLeases.length > 0) return 'in-use';
	const [property] = await db
		.select({ name: properties.name })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	await runBatch(db, [
		db
			.update(properties)
			.set({ archivedAt: date })
			.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId))),
		auditEntry(
			db,
			context,
			'property',
			propertyId,
			'update',
			`Objekt ${property.name} am ${formatDate(date)} archiviert`
		)
	]);
	return 'archived';
}

/** Brings the property back into lists and selects; false when it is not in the account. */
export async function restoreProperty(
	db: Database,
	context: AuditContext,
	propertyId: string
): Promise<boolean> {
	const { accountId } = context;
	const [property] = await db
		.select({ name: properties.name, archivedAt: properties.archivedAt })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	if (!property) return false;
	if (!property.archivedAt) return true;
	await runBatch(db, [
		db
			.update(properties)
			.set({ archivedAt: null })
			.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId))),
		auditEntry(
			db,
			context,
			'property',
			propertyId,
			'update',
			`Objekt ${property.name} aus dem Archiv geholt`
		)
	]);
	return true;
}

// Tenants

export async function tenantArchiving(
	db: Database,
	accountId: string,
	tenantId: string,
	date: IsoDate
): Promise<ArchiveCheck | undefined> {
	const [tenant] = await db
		.select({ archivedAt: tenants.archivedAt })
		.from(tenants)
		.where(and(eq(tenants.accountId, accountId), eq(tenants.id, tenantId)));
	if (!tenant) return undefined;
	const running = await db
		.select({ id: leases.id })
		.from(leaseTenants)
		.innerJoin(leases, eq(leases.id, leaseTenants.leaseId))
		.where(
			and(
				eq(leases.accountId, accountId),
				eq(leaseTenants.tenantId, tenantId),
				notEnded(date),
				// A co-tenant who left a lease that runs on rents no more.
				or(isNull(leaseTenants.leftOn), gte(leaseTenants.leftOn, date))
			)
		);
	return {
		archivedAt: tenant.archivedAt,
		runningLeases: await leaseLinks(
			db,
			accountId,
			running.map((row) => row.id)
		)
	};
}

/** Archives the tenant on the date; refused while one of their leases has not ended. */
export async function archiveTenant(
	db: Database,
	context: AuditContext,
	tenantId: string,
	date: IsoDate
): Promise<'archived' | 'in-use' | 'missing'> {
	const { accountId } = context;
	const check = await tenantArchiving(db, accountId, tenantId, date);
	if (!check) return 'missing';
	if (check.archivedAt) return 'archived';
	if (check.runningLeases.length > 0) return 'in-use';
	const [tenant] = await db
		.select()
		.from(tenants)
		.where(and(eq(tenants.accountId, accountId), eq(tenants.id, tenantId)));
	await runBatch(db, [
		db
			.update(tenants)
			.set({ archivedAt: date })
			.where(and(eq(tenants.accountId, accountId), eq(tenants.id, tenantId))),
		auditEntry(
			db,
			context,
			'tenant',
			tenantId,
			'update',
			`Mieter ${personName(tenant)} am ${formatDate(date)} archiviert`
		)
	]);
	return 'archived';
}

/** Brings the tenant back into lists and selects; false when they are not in the account. */
export async function restoreTenant(
	db: Database,
	context: AuditContext,
	tenantId: string
): Promise<boolean> {
	const { accountId } = context;
	const [tenant] = await db
		.select()
		.from(tenants)
		.where(and(eq(tenants.accountId, accountId), eq(tenants.id, tenantId)));
	if (!tenant) return false;
	if (!tenant.archivedAt) return true;
	await runBatch(db, [
		db
			.update(tenants)
			.set({ archivedAt: null })
			.where(and(eq(tenants.accountId, accountId), eq(tenants.id, tenantId))),
		auditEntry(
			db,
			context,
			'tenant',
			tenantId,
			'update',
			`Mieter ${personName(tenant)} aus dem Archiv geholt`
		)
	]);
	return true;
}
