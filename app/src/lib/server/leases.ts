import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';
import { today } from '../dates';
import { rentOn, type RentChange as RentHistoryEntry } from '../domain/rents';
import type { AuditContext } from './audit';
import { auditEntry } from './audit';
import type { Database } from './db';
import { chunk, rowsPerStatement, runBatch } from './db/batch';
import {
	depositTransactions,
	leasePersons,
	leaseTenants,
	leaseUnits,
	leases,
	payments,
	properties,
	rentCharges,
	rentChanges,
	statementResults,
	tenants,
	units,
	type HeatingCostModel,
	type LeaseKind,
	type OperatingCostModel,
	type RentModel,
	type TerminatedBy
} from './db/schema';

// Leases: the main unit, extra units (parking), tenants and the initial rent. The rent history
// after creation is the rent feature's business (rents.ts); this file only reads it.

export type LeaseInput = {
	unitId: string;
	extraUnitIds: string[];
	tenantIds: string[];
	startDate: string;
	endDate: string | null;
	kind: LeaseKind;
	rentModel: RentModel;
	operatingCostModel: OperatingCostModel;
	heatingCostModel: HeatingCostModel;
	baseRent: number;
	operatingCostPrepayment: number;
	heatingCostPrepayment: number;
	securityDeposit: number;
	persons: number;
	rentDueDay: number;
	ledgerStart: string | null;
	indexBaseMonth: string | null;
	indexBaseValue: number | null;
	terminatedAt: string | null;
	terminatedBy: TerminatedBy | null;
	notes: string | null;
};

export type Lease = typeof leases.$inferSelect;
export type Unit = typeof units.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;

export type LeaseSummary = Lease & {
	unit: Unit;
	property: Property;
	tenants: Tenant[];
	extraUnits: Unit[];
	/** The rent valid today, or the initial rent before the lease starts. */
	currentRent: { baseRent: number; operatingCostPrepayment: number; heatingCostPrepayment: number };
	active: boolean;
};

export function isActive(lease: { startDate: string; endDate: string | null }, date = today()) {
	return lease.startDate <= date && (lease.endDate === null || lease.endDate >= date);
}

/** The lease's label in lists: unit name, property name. */
export function leaseLabel(lease: { unit: { name: string }; property: { name: string } }): string {
	return `${lease.unit.name} · ${lease.property.name}`;
}

async function decorate(db: Database, accountId: string, rows: Lease[]): Promise<LeaseSummary[]> {
	if (rows.length === 0) return [];
	const leaseIds = rows.map((row) => row.id);
	const [allUnits, allProperties, tenantRows, extraRows, changeRows] = await Promise.all([
		db.select().from(units).where(eq(units.accountId, accountId)),
		db.select().from(properties).where(eq(properties.accountId, accountId)),
		db
			.select({ leaseId: leaseTenants.leaseId, tenant: tenants })
			.from(leaseTenants)
			.innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
			.where(inArray(leaseTenants.leaseId, leaseIds))
			.orderBy(asc(tenants.lastName), asc(tenants.firstName)),
		db
			.select({ leaseId: leaseUnits.leaseId, unit: units })
			.from(leaseUnits)
			.innerJoin(units, eq(leaseUnits.unitId, units.id))
			.where(inArray(leaseUnits.leaseId, leaseIds))
			.orderBy(asc(units.name)),
		db
			.select()
			.from(rentChanges)
			.where(and(eq(rentChanges.accountId, accountId), inArray(rentChanges.leaseId, leaseIds)))
	]);
	const unitById = new Map(allUnits.map((unit) => [unit.id, unit]));
	const propertyById = new Map(allProperties.map((property) => [property.id, property]));
	const date = today();

	return rows.flatMap((lease) => {
		const unit = unitById.get(lease.unitId);
		const property = unit && propertyById.get(unit.propertyId);
		if (!unit || !property) return [];
		const history: RentHistoryEntry[] = changeRows.filter((row) => row.leaseId === lease.id);
		const current = rentOn(history, date) ??
			rentOn(history, lease.startDate) ?? {
				baseRent: lease.baseRent,
				operatingCostPrepayment: lease.operatingCostPrepayment,
				heatingCostPrepayment: lease.heatingCostPrepayment
			};
		return [
			{
				...lease,
				unit,
				property,
				tenants: tenantRows.filter((row) => row.leaseId === lease.id).map((row) => row.tenant),
				extraUnits: extraRows.filter((row) => row.leaseId === lease.id).map((row) => row.unit),
				currentRent: {
					baseRent: current.baseRent,
					operatingCostPrepayment: current.operatingCostPrepayment,
					heatingCostPrepayment: current.heatingCostPrepayment
				},
				active: isActive(lease, date)
			}
		];
	});
}

/** All leases of the account, newest start first. */
export async function listLeases(
	db: Database,
	accountId: string,
	filter: { unitId?: string; tenantId?: string; propertyId?: string } = {}
): Promise<LeaseSummary[]> {
	let rows = await db
		.select()
		.from(leases)
		.where(eq(leases.accountId, accountId))
		.orderBy(desc(leases.startDate));
	if (filter.unitId) {
		const extra = await db
			.select({ leaseId: leaseUnits.leaseId })
			.from(leaseUnits)
			.where(eq(leaseUnits.unitId, filter.unitId));
		const extraIds = new Set(extra.map((row) => row.leaseId));
		rows = rows.filter((row) => row.unitId === filter.unitId || extraIds.has(row.id));
	}
	if (filter.tenantId) {
		const links = await db
			.select({ leaseId: leaseTenants.leaseId })
			.from(leaseTenants)
			.where(eq(leaseTenants.tenantId, filter.tenantId));
		const ids = new Set(links.map((row) => row.leaseId));
		rows = rows.filter((row) => ids.has(row.id));
	}
	const summaries = await decorate(db, accountId, rows);
	return filter.propertyId
		? summaries.filter((lease) => lease.property.id === filter.propertyId)
		: summaries;
}

export async function getLease(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<LeaseSummary | undefined> {
	const rows = await db
		.select()
		.from(leases)
		.where(and(eq(leases.accountId, accountId), eq(leases.id, leaseId)));
	const [lease] = await decorate(db, accountId, rows);
	return lease;
}

export type LeaseError = 'unknown-unit' | 'unknown-tenant' | 'missing';

async function checkReferences(
	db: Database,
	accountId: string,
	input: LeaseInput
): Promise<LeaseError | undefined> {
	const unitIds = [input.unitId, ...input.extraUnitIds];
	const ownUnits = await db
		.select({ id: units.id })
		.from(units)
		.where(and(eq(units.accountId, accountId), inArray(units.id, unitIds)));
	if (ownUnits.length !== new Set(unitIds).size) return 'unknown-unit';
	if (input.tenantIds.length > 0) {
		const ownTenants = await db
			.select({ id: tenants.id })
			.from(tenants)
			.where(and(eq(tenants.accountId, accountId), inArray(tenants.id, input.tenantIds)));
		if (ownTenants.length !== new Set(input.tenantIds).size) return 'unknown-tenant';
	}
	return undefined;
}

function leaseColumns(input: LeaseInput) {
	return {
		unitId: input.unitId,
		startDate: input.startDate,
		endDate: input.endDate,
		kind: input.kind,
		rentModel: input.rentModel,
		operatingCostModel: input.operatingCostModel,
		heatingCostModel: input.heatingCostModel,
		baseRent: input.baseRent,
		operatingCostPrepayment: input.operatingCostPrepayment,
		heatingCostPrepayment: input.heatingCostPrepayment,
		securityDeposit: input.securityDeposit,
		persons: input.persons,
		rentDueDay: input.rentDueDay,
		ledgerStart: input.ledgerStart,
		indexBaseMonth: input.indexBaseMonth,
		indexBaseValue: input.indexBaseValue,
		terminatedAt: input.terminatedAt,
		terminatedBy: input.terminatedBy,
		notes: input.notes
	};
}

/** Creates the lease with its tenants, extra units, the initial rent and persons, atomically. */
export async function createLease(
	db: Database,
	context: AuditContext,
	input: LeaseInput
): Promise<{ ok: true; id: string } | { ok: false; reason: LeaseError }> {
	const { accountId } = context;
	const reason = await checkReferences(db, accountId, input);
	if (reason) return { ok: false, reason };

	const id = crypto.randomUUID();
	const extraUnitIds = [...new Set(input.extraUnitIds)].filter((unitId) => unitId !== input.unitId);
	const tenantIds = [...new Set(input.tenantIds)];
	await runBatch(db, [
		db.insert(leases).values({ id, accountId, ...leaseColumns(input) }),
		...chunk(tenantIds, rowsPerStatement(leaseTenants)).map((ids) =>
			db.insert(leaseTenants).values(ids.map((tenantId) => ({ leaseId: id, tenantId })))
		),
		...chunk(extraUnitIds, rowsPerStatement(leaseUnits)).map((ids) =>
			db.insert(leaseUnits).values(ids.map((unitId) => ({ accountId, leaseId: id, unitId })))
		),
		db.insert(rentChanges).values({
			accountId,
			leaseId: id,
			validFrom: input.startDate,
			baseRent: input.baseRent,
			operatingCostPrepayment: input.operatingCostPrepayment,
			heatingCostPrepayment: input.heatingCostPrepayment,
			reason: 'initial',
			status: 'approved',
			createdBy: context.userId
		}),
		db.insert(leasePersons).values({
			accountId,
			leaseId: id,
			validFrom: input.startDate,
			persons: input.persons
		}),
		auditEntry(db, context, 'lease', id, 'create', 'Mietvertrag angelegt')
	]);
	return { ok: true, id };
}

/**
 * Updates the lease, its tenants and extra units. The initial rent change and persons row follow
 * the new start date and initial values; later changes stay as they are. The rent charges are
 * not touched here; the caller syncs them through the ledger module.
 */
export async function updateLease(
	db: Database,
	context: AuditContext,
	leaseId: string,
	input: LeaseInput
): Promise<{ ok: true } | { ok: false; reason: LeaseError }> {
	const { accountId } = context;
	const existing = await getLease(db, accountId, leaseId);
	if (!existing) return { ok: false, reason: 'missing' };
	const reason = await checkReferences(db, accountId, input);
	if (reason) return { ok: false, reason };

	const extraUnitIds = [...new Set(input.extraUnitIds)].filter((unitId) => unitId !== input.unitId);
	const tenantIds = [...new Set(input.tenantIds)];
	await runBatch(db, [
		db
			.update(leases)
			.set(leaseColumns(input))
			.where(and(eq(leases.accountId, accountId), eq(leases.id, leaseId))),
		db.delete(leaseTenants).where(eq(leaseTenants.leaseId, leaseId)),
		...chunk(tenantIds, rowsPerStatement(leaseTenants)).map((ids) =>
			db.insert(leaseTenants).values(ids.map((tenantId) => ({ leaseId, tenantId })))
		),
		db.delete(leaseUnits).where(eq(leaseUnits.leaseId, leaseId)),
		...chunk(extraUnitIds, rowsPerStatement(leaseUnits)).map((ids) =>
			db.insert(leaseUnits).values(ids.map((unitId) => ({ accountId, leaseId, unitId })))
		),
		db
			.update(rentChanges)
			.set({
				validFrom: input.startDate,
				baseRent: input.baseRent,
				operatingCostPrepayment: input.operatingCostPrepayment,
				heatingCostPrepayment: input.heatingCostPrepayment
			})
			.where(and(eq(rentChanges.leaseId, leaseId), eq(rentChanges.reason, 'initial'))),
		db
			.update(leasePersons)
			.set({ validFrom: input.startDate, persons: input.persons })
			.where(
				and(eq(leasePersons.leaseId, leaseId), eq(leasePersons.validFrom, existing.startDate))
			),
		auditEntry(db, context, 'lease', leaseId, 'update', 'Mietvertrag geändert')
	]);
	return { ok: true };
}

/**
 * Deletes the lease with its rent history and generated rent charges. A lease with money on it
 * (payments, deposit movements, statement balances or other postings) is ended, not deleted,
 * so the history stays; the page offers "Vertrag beenden" instead.
 */
export async function deleteLease(
	db: Database,
	context: AuditContext,
	leaseId: string
): Promise<'deleted' | 'in-use' | 'missing'> {
	const existing = await getLease(db, context.accountId, leaseId);
	if (!existing) return 'missing';
	if (await hasMoney(db, leaseId)) return 'in-use';
	await runBatch(db, [
		db.delete(leases).where(and(eq(leases.accountId, context.accountId), eq(leases.id, leaseId))),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'delete',
			`Mietvertrag ${leaseLabel(existing)} gelöscht`
		)
	]);
	return 'deleted';
}

/** Whether payments, deposit movements or postings other than the monthly rent exist. */
export async function hasMoney(db: Database, leaseId: string): Promise<boolean> {
	const [[paid], [deposit], [posted], [settled]] = await Promise.all([
		db.select({ value: count() }).from(payments).where(eq(payments.leaseId, leaseId)),
		db
			.select({ value: count() })
			.from(depositTransactions)
			.where(eq(depositTransactions.leaseId, leaseId)),
		db
			.select({ value: count() })
			.from(rentCharges)
			.where(and(eq(rentCharges.leaseId, leaseId), ne(rentCharges.kind, 'rent'))),
		db
			.select({ value: count() })
			.from(statementResults)
			.where(eq(statementResults.leaseId, leaseId))
	]);
	return paid.value + deposit.value + posted.value + settled.value > 0;
}

/** The units of the account with their property, for selects. */
export async function listUnitsWithProperty(db: Database, accountId: string) {
	return db
		.select({ unit: units, property: properties })
		.from(units)
		.innerJoin(properties, eq(units.propertyId, properties.id))
		.where(eq(units.accountId, accountId))
		.orderBy(asc(properties.name), asc(units.name));
}
