import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { formatDate, monthOf, today, type IsoDate } from '../dates';
import { rentOn, type RentChange as RentHistoryEntry } from '../domain/rents';
import { terminatedByLabels } from '../labels';
import { formatCents } from '../money';
import type { GermanState } from '../working-days';
import type { AuditContext } from './audit';
import { auditEntry } from './audit';
import type { Database } from './db';
import { chunk, chunkIds, rowsPerStatement, runBatch } from './db/batch';
import {
	chargeStatements,
	chargeSyncStatements,
	leaseChargeStatements,
	unitStates,
	type ChargeLease
} from './ledger';
import {
	laterRows,
	laterRowsNote,
	noLaterRows,
	withLaterRows,
	type LaterRows
} from './rent-history';
import {
	auditLog,
	leasePersons,
	leaseTenants,
	leaseUnits,
	leases,
	operatingCostStatements,
	properties,
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
import { assertQuota } from './quotas';

// Leases: the main unit, extra units (parking), tenants, the initial rent and persons, the
// persons history and the end of the lease. The rent history after creation is the business of
// rent-adjustments.ts; this file only reads it through rents.ts.

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
	indexBaseYear: string;
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
	/** Starts after today; a lease neither active nor upcoming has ended. */
	upcoming: boolean;
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
	// D1 binds at most 100 parameters per statement: the lease ids go in groups (chunkIds), one
	// query per table and group, and the groups' rows are put together again.
	const groups = chunkIds(rows.map((row) => row.id));
	const [allUnits, allProperties, tenantGroups, extraGroups, changeGroups] = await Promise.all([
		db.select().from(units).where(eq(units.accountId, accountId)),
		db.select().from(properties).where(eq(properties.accountId, accountId)),
		Promise.all(
			groups.map((leaseIds) =>
				db
					.select({ leaseId: leaseTenants.leaseId, tenant: tenants })
					.from(leaseTenants)
					.innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
					.where(and(eq(tenants.accountId, accountId), inArray(leaseTenants.leaseId, leaseIds)))
			)
		),
		Promise.all(
			groups.map((leaseIds) =>
				db
					.select({ leaseId: leaseUnits.leaseId, unit: units })
					.from(leaseUnits)
					.innerJoin(units, eq(leaseUnits.unitId, units.id))
					.where(and(eq(leaseUnits.accountId, accountId), inArray(leaseUnits.leaseId, leaseIds)))
			)
		),
		Promise.all(
			groups.map((leaseIds) =>
				db
					.select()
					.from(rentChanges)
					.where(and(eq(rentChanges.accountId, accountId), inArray(rentChanges.leaseId, leaseIds)))
			)
		)
	]);
	// Ordered as SQLite's ORDER BY did (binary), across the groups.
	const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
	const tenantRows = tenantGroups
		.flat()
		.sort(
			(a, b) =>
				binary(a.tenant.lastName, b.tenant.lastName) ||
				binary(a.tenant.firstName, b.tenant.firstName)
		);
	const extraRows = extraGroups.flat().sort((a, b) => binary(a.unit.name, b.unit.name));
	const changeRows = changeGroups.flat();
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
				active: isActive(lease, date),
				upcoming: lease.startDate > date
			}
		];
	});
}

/** All leases of the account, newest start first. */
export async function listLeases(
	db: Database,
	accountId: string,
	filter: { unitId?: string; tenantId?: string } = {}
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
			.where(and(eq(leaseUnits.accountId, accountId), eq(leaseUnits.unitId, filter.unitId)));
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
	return decorate(db, accountId, rows);
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

export type LeaseError =
	| 'unknown-unit'
	| 'unknown-tenant'
	| 'archived'
	| 'missing'
	| 'start-after-changes'
	| 'settled-property'
	| 'overlap';

/** A refused lease; an overlap names the start of the other lease. */
export type LeaseRefusal =
	| { ok: false; reason: Exclude<LeaseError, 'overlap' | 'start-after-changes'> }
	| { ok: false; reason: 'overlap' | 'start-after-changes'; date: IsoDate };

/** Whether two terms share a day; an open end runs on indefinitely. */
export function termsOverlap(
	a: { startDate: IsoDate; endDate: IsoDate | null },
	b: { startDate: IsoDate; endDate: IsoDate | null }
): boolean {
	return a.startDate <= (b.endDate ?? '9999-12-31') && b.startDate <= (a.endDate ?? '9999-12-31');
}

/**
 * The start of another lease that holds one of the units (as main or extra unit) on a day of the
 * term: two leases of one unit at once would split its operating costs between them.
 */
async function overlappingLease(
	db: Database,
	accountId: string,
	term: { unitIds: string[]; startDate: IsoDate; endDate: IsoDate | null },
	exceptLeaseId?: string
): Promise<IsoDate | undefined> {
	const unitIds = [...new Set(term.unitIds)];
	const starts: IsoDate[] = [];
	for (const ids of chunkIds(unitIds)) {
		const [main, extra] = await Promise.all([
			db
				.select({ id: leases.id, startDate: leases.startDate, endDate: leases.endDate })
				.from(leases)
				.where(and(eq(leases.accountId, accountId), inArray(leases.unitId, ids))),
			db
				.select({ id: leases.id, startDate: leases.startDate, endDate: leases.endDate })
				.from(leaseUnits)
				.innerJoin(leases, eq(leases.id, leaseUnits.leaseId))
				.where(and(eq(leaseUnits.accountId, accountId), inArray(leaseUnits.unitId, ids)))
		]);
		for (const lease of [...main, ...extra]) {
			if (lease.id !== exceptLeaseId && termsOverlap(lease, term)) starts.push(lease.startDate);
		}
	}
	return starts.sort()[0];
}

/**
 * Whether the units and tenants exist in the account and none is archived (a unit counts as
 * archived with its property). What the lease already names stays allowed, so an edit of a lease
 * of a sold property or a moved-out tenant still saves.
 */
async function checkReferences(
	db: Database,
	accountId: string,
	input: LeaseInput,
	kept: { unitIds: string[]; tenantIds: string[] } = { unitIds: [], tenantIds: [] }
): Promise<Exclude<LeaseError, 'overlap' | 'start-after-changes'> | undefined> {
	// The form does not cap the number of ids, so they go in groups (D1 binds at most 100).
	const unitIds = [...new Set([input.unitId, ...input.extraUnitIds])];
	let ownUnits = 0;
	let archived = false;
	for (const ids of chunkIds(unitIds)) {
		const rows = await db
			.select({ id: units.id, archivedAt: properties.archivedAt })
			.from(units)
			.innerJoin(properties, eq(properties.id, units.propertyId))
			.where(and(eq(units.accountId, accountId), inArray(units.id, ids)));
		ownUnits += rows.length;
		if (rows.some((row) => row.archivedAt && !kept.unitIds.includes(row.id))) archived = true;
	}
	if (ownUnits !== unitIds.length) return 'unknown-unit';
	const tenantIds = [...new Set(input.tenantIds)];
	let ownTenants = 0;
	for (const ids of chunkIds(tenantIds)) {
		const rows = await db
			.select({ id: tenants.id, archivedAt: tenants.archivedAt })
			.from(tenants)
			.where(and(eq(tenants.accountId, accountId), inArray(tenants.id, ids)));
		ownTenants += rows.length;
		if (rows.some((row) => row.archivedAt && !kept.tenantIds.includes(row.id))) archived = true;
	}
	if (ownTenants !== tenantIds.length) return 'unknown-tenant';
	return archived ? 'archived' : undefined;
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
		indexBaseYear: input.indexBaseYear,
		terminatedAt: input.terminatedAt,
		terminatedBy: input.terminatedBy,
		notes: input.notes
	};
}

/**
 * The inserts that create new leases with their tenants, extra units, the initial rent, the first
 * persons row and the "Mietvertrag angelegt" audit line, as bulk inserts chunked for D1's
 * parameter limit. Every id is given or generated here, so a caller can put any number of leases
 * into one batch (the CSV import, the demo data; the end-to-end seed puts the lease's property,
 * unit and tenant in the same one). The references must already be checked against the account.
 */
export function newLeaseStatements(
	db: Database,
	context: AuditContext,
	entries: { id: string; input: LeaseInput }[]
): BatchItem<'sqlite'>[] {
	const { accountId } = context;
	const leaseRows = entries.map(({ id, input }) => ({ id, accountId, ...leaseColumns(input) }));
	const tenantRows = entries.flatMap(({ id, input }) =>
		[...new Set(input.tenantIds)].map((tenantId) => ({ leaseId: id, tenantId }))
	);
	const extraUnitRows = entries.flatMap(({ id, input }) =>
		[...new Set(input.extraUnitIds)]
			.filter((unitId) => unitId !== input.unitId)
			.map((unitId) => ({ accountId, leaseId: id, unitId }))
	);
	const rentChangeRows = entries.map(({ id, input }) => ({
		id: crypto.randomUUID(),
		accountId,
		leaseId: id,
		validFrom: input.startDate,
		baseRent: input.baseRent,
		operatingCostPrepayment: input.operatingCostPrepayment,
		heatingCostPrepayment: input.heatingCostPrepayment,
		reason: 'initial' as const,
		status: 'approved' as const,
		createdBy: context.userId
	}));
	const personsRows = entries.map(({ id, input }) => ({
		id: crypto.randomUUID(),
		accountId,
		leaseId: id,
		validFrom: input.startDate,
		persons: input.persons
	}));
	const auditRows = entries.map(({ id }) => ({
		id: crypto.randomUUID(),
		accountId,
		userId: context.userId,
		entity: 'lease',
		entityId: id,
		action: 'create' as const,
		summary: 'Mietvertrag angelegt'
	}));
	return [
		...chunk(leaseRows, rowsPerStatement(leases)).map((rows) => db.insert(leases).values(rows)),
		...chunk(tenantRows, rowsPerStatement(leaseTenants)).map((rows) =>
			db.insert(leaseTenants).values(rows)
		),
		...chunk(extraUnitRows, rowsPerStatement(leaseUnits)).map((rows) =>
			db.insert(leaseUnits).values(rows)
		),
		...chunk(rentChangeRows, rowsPerStatement(rentChanges)).map((rows) =>
			db.insert(rentChanges).values(rows)
		),
		...chunk(personsRows, rowsPerStatement(leasePersons)).map((rows) =>
			db.insert(leasePersons).values(rows)
		),
		...chunk(auditRows, rowsPerStatement(auditLog)).map((rows) => db.insert(auditLog).values(rows))
	];
}

/** The lease as the rent charges see it once `input` is stored, with its rent history. */
function chargeLeaseOf(
	id: string,
	input: LeaseInput,
	states: Map<string, GermanState | null>,
	changes: readonly RentHistoryEntry[]
): ChargeLease {
	return {
		id,
		startDate: input.startDate,
		endDate: input.endDate,
		ledgerStart: input.ledgerStart,
		rentDueDay: input.rentDueDay,
		state: states.get(input.unitId) ?? null,
		changes
	};
}

/** The initial rent of a lease about to be created, as its rent history. */
function initialHistory(input: LeaseInput): RentHistoryEntry[] {
	return [
		{
			validFrom: input.startDate,
			baseRent: input.baseRent,
			operatingCostPrepayment: input.operatingCostPrepayment,
			heatingCostPrepayment: input.heatingCostPrepayment,
			status: 'approved'
		}
	];
}

/**
 * The leases about to be created as the rent charges see them, so their charges go into the
 * batch that creates them. The units must already be checked against the account.
 */
export async function newChargeLeases(
	db: Database,
	accountId: string,
	entries: { id: string; input: LeaseInput }[]
): Promise<ChargeLease[]> {
	const states = await unitStates(
		db,
		accountId,
		entries.map(({ input }) => input.unitId)
	);
	return entries.map(({ id, input }) => chargeLeaseOf(id, input, states, initialHistory(input)));
}

/**
 * Creates the lease with its tenants, extra units, the initial rent and persons, and its rent
 * charges up to this month, atomically. A non-zero opening balance (Anfangssaldo) is posted in
 * the same batch, due at the ledger start.
 */
export async function createLease(
	db: Database,
	context: AuditContext,
	input: LeaseInput,
	openingBalance: number | null = null
): Promise<{ ok: true; id: string } | LeaseRefusal> {
	await assertQuota(db, context.accountId, 'leases');
	const reason = await checkReferences(db, context.accountId, input);
	if (reason) return { ok: false, reason };
	const overlap = await overlappingLease(db, context.accountId, {
		unitIds: [input.unitId, ...input.extraUnitIds],
		startDate: input.startDate,
		endDate: input.endDate
	});
	if (overlap) return { ok: false, reason: 'overlap', date: overlap };
	const id = crypto.randomUUID();
	const ledgerStart = input.ledgerStart ?? input.startDate;
	const charges = await chargeSyncStatements(
		db,
		context.accountId,
		await newChargeLeases(db, context.accountId, [{ id, input }]),
		{ otherCharges: openingBalance ? 1 : 0 }
	);
	await runBatch(db, [
		...newLeaseStatements(db, context, [{ id, input }]),
		...(openingBalance
			? chargeStatements(db, context, crypto.randomUUID(), {
					leaseId: id,
					kind: 'adjustment',
					period: monthOf(ledgerStart),
					dueDate: ledgerStart,
					amount: openingBalance,
					note: 'Anfangssaldo'
				})
			: []),
		...charges.statements
	]);
	return { ok: true, id };
}

/**
 * Whether the new units leave a property for which an operating cost statement settled the lease:
 * the statement would then name a lease that has nothing in its property.
 */
async function leavesSettledProperty(
	db: Database,
	accountId: string,
	leaseId: string,
	input: LeaseInput
): Promise<boolean> {
	const settled = await db
		.selectDistinct({ propertyId: operatingCostStatements.propertyId })
		.from(statementResults)
		.innerJoin(
			operatingCostStatements,
			eq(operatingCostStatements.id, statementResults.statementId)
		)
		.where(and(eq(statementResults.accountId, accountId), eq(statementResults.leaseId, leaseId)));
	if (settled.length === 0) return false;
	const unitIds = [...new Set([input.unitId, ...input.extraUnitIds])];
	const kept = new Set<string>();
	for (const ids of chunkIds(unitIds)) {
		const rows = await db
			.select({ propertyId: units.propertyId })
			.from(units)
			.where(and(eq(units.accountId, accountId), inArray(units.id, ids)));
		for (const row of rows) kept.add(row.propertyId);
	}
	return settled.some((row) => !kept.has(row.propertyId));
}

/**
 * Updates the lease, its tenants and extra units. The initial rent change and persons row follow
 * the new start date and initial values; later rows that carried an initial amount unchanged
 * follow it too (see laterRows). A start date on or after a later rent change or persons row is
 * refused ('start-after-changes'), since those rows would then come first or collide with the
 * initial ones. A new start, end, due day, ledger start or unit moves the rent charges, which are
 * synced in the same batch.
 */
export async function updateLease(
	db: Database,
	context: AuditContext,
	leaseId: string,
	input: LeaseInput
): Promise<{ ok: true } | LeaseRefusal> {
	const { accountId } = context;
	const existing = await getLease(db, accountId, leaseId);
	if (!existing) return { ok: false, reason: 'missing' };
	const reason = await checkReferences(db, accountId, input, {
		unitIds: [existing.unitId, ...existing.extraUnits.map((unit) => unit.id)],
		tenantIds: existing.tenants.map((tenant) => tenant.id)
	});
	if (reason) return { ok: false, reason };
	if (await leavesSettledProperty(db, accountId, leaseId, input)) {
		return { ok: false, reason: 'settled-property' };
	}
	const overlap = await overlappingLease(
		db,
		accountId,
		{
			unitIds: [input.unitId, ...input.extraUnitIds],
			startDate: input.startDate,
			endDate: input.endDate
		},
		leaseId
	);
	if (overlap) return { ok: false, reason: 'overlap', date: overlap };

	const [changes, personsRows] = await Promise.all([
		db
			.select()
			.from(rentChanges)
			.where(and(eq(rentChanges.accountId, accountId), eq(rentChanges.leaseId, leaseId))),
		db
			.select()
			.from(leasePersons)
			.where(and(eq(leasePersons.accountId, accountId), eq(leasePersons.leaseId, leaseId)))
	]);
	const initial = changes.find((change) => change.reason === 'initial');
	const blocking = [
		...changes
			.filter((change) => change.reason !== 'initial' && change.status === 'approved')
			.map((change) => change.validFrom),
		...personsRows.filter((row) => row.validFrom !== existing.startDate).map((row) => row.validFrom)
	]
		.filter((date) => date <= input.startDate)
		.sort();
	if (blocking.length > 0) return { ok: false, reason: 'start-after-changes', date: blocking[0] };

	const amounts = {
		baseRent: input.baseRent,
		operatingCostPrepayment: input.operatingCostPrepayment,
		heatingCostPrepayment: input.heatingCostPrepayment
	};
	const later = initial
		? laterRows(db, accountId, changes, input.startDate, initial, amounts, initial.id)
		: noLaterRows;
	const history = withLaterRows(changes, later).map((change) =>
		change.reason === 'initial' ? { ...change, validFrom: input.startDate, ...amounts } : change
	);
	const states = await unitStates(db, accountId, [input.unitId]);
	const charges = await chargeSyncStatements(db, accountId, [
		chargeLeaseOf(leaseId, input, states, history)
	]);
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
			.set({ validFrom: input.startDate, ...amounts })
			.where(
				and(
					eq(rentChanges.accountId, accountId),
					eq(rentChanges.leaseId, leaseId),
					eq(rentChanges.reason, 'initial')
				)
			),
		...later.statements,
		db
			.update(leasePersons)
			.set({ validFrom: input.startDate, persons: input.persons })
			.where(
				and(
					eq(leasePersons.accountId, accountId),
					eq(leasePersons.leaseId, leaseId),
					eq(leasePersons.validFrom, existing.startDate)
				)
			),
		auditEntry(db, context, 'lease', leaseId, 'update', updateSummary(existing, input, later)),
		...charges.statements
	]);
	return { ok: true };
}

/** "Mietvertrag geändert", naming the initial amounts, deposit and persons when they changed. */
function updateSummary(existing: Lease, input: LeaseInput, later: LaterRows): string {
	const changed: string[] = [];
	if (existing.startDate !== input.startDate) {
		changed.push(`Beginn ${formatDate(input.startDate)}`);
	}
	if (existing.baseRent !== input.baseRent) {
		changed.push(`Kaltmiete bei Vertragsbeginn ${formatCents(input.baseRent)}`);
	}
	if (existing.operatingCostPrepayment !== input.operatingCostPrepayment) {
		changed.push(`Betriebskostenvorauszahlung ${formatCents(input.operatingCostPrepayment)}`);
	}
	if (existing.heatingCostPrepayment !== input.heatingCostPrepayment) {
		changed.push(`Heizkostenvorauszahlung ${formatCents(input.heatingCostPrepayment)}`);
	}
	if (existing.securityDeposit !== input.securityDeposit) {
		changed.push(`Kaution ${formatCents(input.securityDeposit)}`);
	}
	if (existing.persons !== input.persons) changed.push(`Personen bei Einzug ${input.persons}`);
	return changed.length === 0
		? 'Mietvertrag geändert'
		: `Mietvertrag geändert: ${changed.join(', ')}${laterRowsNote(later)}`;
}

/** The units of the account with their property, for selects; archived properties' only on request. */
export async function listUnitsWithProperty(
	db: Database,
	accountId: string,
	options: { archived?: boolean } = {}
) {
	return db
		.select({ unit: units, property: properties })
		.from(units)
		.innerJoin(properties, eq(units.propertyId, properties.id))
		.where(
			and(
				eq(units.accountId, accountId),
				options.archived ? undefined : isNull(properties.archivedAt)
			)
		)
		.orderBy(asc(properties.name), asc(units.name));
}

/** The lease's columns as a LeaseInput, so the edit form can change some fields and keep the rest. */
export function leaseInputOf(lease: LeaseSummary): LeaseInput {
	return {
		unitId: lease.unitId,
		extraUnitIds: lease.extraUnits.map((unit) => unit.id),
		tenantIds: lease.tenants.map((tenant) => tenant.id),
		startDate: lease.startDate,
		endDate: lease.endDate,
		kind: lease.kind,
		rentModel: lease.rentModel,
		operatingCostModel: lease.operatingCostModel,
		heatingCostModel: lease.heatingCostModel,
		baseRent: lease.baseRent,
		operatingCostPrepayment: lease.operatingCostPrepayment,
		heatingCostPrepayment: lease.heatingCostPrepayment,
		securityDeposit: lease.securityDeposit,
		persons: lease.persons,
		rentDueDay: lease.rentDueDay,
		ledgerStart: lease.ledgerStart,
		indexBaseMonth: lease.indexBaseMonth,
		indexBaseValue: lease.indexBaseValue,
		indexBaseYear: lease.indexBaseYear,
		terminatedAt: lease.terminatedAt,
		terminatedBy: lease.terminatedBy,
		notes: lease.notes
	};
}

export type LeaseEndInput = {
	/** The day the notice was received. */
	terminatedAt: IsoDate;
	terminatedBy: TerminatedBy;
	endDate: IsoDate;
	/** An end before the legal notice period, agreed with the other party (Aufhebungsvertrag). */
	earlyEndAgreed?: boolean;
};

/**
 * Records the notice and the end date ("Vertrag beenden"). The rent charges are synced in the
 * same batch, so months after the end disappear from the ledger.
 */
export async function endLease(
	db: Database,
	context: AuditContext,
	leaseId: string,
	input: LeaseEndInput
): Promise<'ended' | 'missing' | 'before-start' | { overlap: IsoDate }> {
	const existing = await getLease(db, context.accountId, leaseId);
	if (!existing) return 'missing';
	if (input.endDate < existing.startDate) return 'before-start';
	const overlap = await overlappingLease(
		db,
		context.accountId,
		{
			unitIds: [existing.unitId, ...existing.extraUnits.map((unit) => unit.id)],
			startDate: existing.startDate,
			endDate: input.endDate
		},
		leaseId
	);
	if (overlap) return { overlap };
	await runBatch(db, [
		db
			.update(leases)
			.set({
				terminatedAt: input.terminatedAt,
				terminatedBy: input.terminatedBy,
				endDate: input.endDate
			})
			.where(and(eq(leases.accountId, context.accountId), eq(leases.id, leaseId))),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'update',
			`Mietvertrag ${leaseLabel(existing)} zum ${formatDate(input.endDate)} beendet (Kündigung vom ${formatDate(input.terminatedAt)} ${terminatedByLabels[input.terminatedBy]}${input.earlyEndAgreed ? ', früheres Ende vereinbart' : ''})`
		),
		...(await leaseChargeStatements(db, context.accountId, leaseId, { endDate: input.endDate }))
	]);
	return 'ended';
}

export type LeasePersonsRow = typeof leasePersons.$inferSelect;

/** The persons history (Personenstand) of the lease, oldest first. */
export async function listLeasePersons(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<LeasePersonsRow[]> {
	return db
		.select()
		.from(leasePersons)
		.where(and(eq(leasePersons.accountId, accountId), eq(leasePersons.leaseId, leaseId)))
		.orderBy(asc(leasePersons.validFrom));
}

export type LeasePersonsInput = { validFrom: IsoDate; persons: number; note: string | null };

/**
 * Adds a row "ab Datum" to the persons history. One row per date (unique index), and none
 * before the lease starts; both are refused with a reason instead of a database error.
 */
export async function addLeasePersons(
	db: Database,
	context: AuditContext,
	leaseId: string,
	input: LeasePersonsInput
): Promise<
	{ ok: true; id: string } | { ok: false; reason: 'missing' | 'duplicate' | 'before-start' }
> {
	await assertQuota(db, context.accountId, 'leasePersons');
	const { accountId } = context;
	const existing = await getLease(db, accountId, leaseId);
	if (!existing) return { ok: false, reason: 'missing' };
	if (input.validFrom < existing.startDate) return { ok: false, reason: 'before-start' };
	const rows = await listLeasePersons(db, accountId, leaseId);
	if (rows.some((row) => row.validFrom === input.validFrom)) {
		return { ok: false, reason: 'duplicate' };
	}
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(leasePersons).values({ id, accountId, leaseId, ...input }),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'update',
			`Personenstand ab ${formatDate(input.validFrom)}: ${input.persons} ${input.persons === 1 ? 'Person' : 'Personen'}`
		)
	]);
	return { ok: true, id };
}

/**
 * Changes a later row of the persons history; the first one moves with the lease (see
 * deleteLeasePersons). The same date rules as for a new row apply.
 */
export async function updateLeasePersons(
	db: Database,
	context: AuditContext,
	leaseId: string,
	rowId: string,
	input: LeasePersonsInput
): Promise<'updated' | 'initial' | 'missing' | 'duplicate' | 'before-start'> {
	const { accountId } = context;
	const existing = await getLease(db, accountId, leaseId);
	if (!existing) return 'missing';
	const rows = await listLeasePersons(db, accountId, leaseId);
	const row = rows.find((candidate) => candidate.id === rowId);
	if (!row) return 'missing';
	if (row.validFrom === existing.startDate) return 'initial';
	if (input.validFrom <= existing.startDate) return 'before-start';
	if (rows.some((other) => other.id !== rowId && other.validFrom === input.validFrom)) {
		return 'duplicate';
	}
	await runBatch(db, [
		db
			.update(leasePersons)
			.set(input)
			.where(and(eq(leasePersons.accountId, accountId), eq(leasePersons.id, rowId))),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'update',
			`Personenstand ab ${formatDate(input.validFrom)} geändert: ${input.persons} ${input.persons === 1 ? 'Person' : 'Personen'}`
		)
	]);
	return 'updated';
}

/**
 * Deletes a row of the persons history. The first row belongs to the lease itself (it carries
 * the initial value and moves with the start date), so it stays.
 */
export async function deleteLeasePersons(
	db: Database,
	context: AuditContext,
	leaseId: string,
	rowId: string
): Promise<'deleted' | 'initial' | 'missing'> {
	const { accountId } = context;
	const existing = await getLease(db, accountId, leaseId);
	if (!existing) return 'missing';
	const [row] = await db
		.select()
		.from(leasePersons)
		.where(
			and(
				eq(leasePersons.accountId, accountId),
				eq(leasePersons.leaseId, leaseId),
				eq(leasePersons.id, rowId)
			)
		);
	if (!row) return 'missing';
	if (row.validFrom === existing.startDate) return 'initial';
	await runBatch(db, [
		db
			.delete(leasePersons)
			.where(and(eq(leasePersons.accountId, accountId), eq(leasePersons.id, rowId))),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'update',
			`Personenstand ab ${formatDate(row.validFrom)} entfernt`
		)
	]);
	return 'deleted';
}
