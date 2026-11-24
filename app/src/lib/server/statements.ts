import { mainFirst } from '../domain/addressee';
import { and, asc, desc, eq, gte, inArray, lt, lte, or } from 'drizzle-orm';
import { currentParties } from '../domain/lease-parties';
import type { BatchItem } from 'drizzle-orm/batch';
import { addDays, formatDate, monthOf, today, type DateRange, type IsoDate } from '../dates';
import type { Meter, Reading } from '../domain/consumption';
import {
	approveLease,
	computeStatement,
	DUE_DAYS,
	leaseLabel,
	objectionDeadline,
	periodLabel,
	validatePeriod,
	type LeaseStatement,
	type LedgerCharge,
	type PreviousPeriod,
	type PropertyResult,
	type StatementInput,
	type StatementLease,
	type StatementOptions,
	type StatementResult,
	type StatementWarning
} from '../domain/statement';
import { pluralize } from '../format';
import { formatCents } from '../money';
import { landlordAddress } from './accounts';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { chunk, rowsPerStatement, runBatch, selectInChunks } from './db/batch';
import {
	allocationKeyShares,
	allocationKeys,
	billingCircleUnits,
	billingCircles,
	costCategories,
	costItemUnitAmounts,
	costItems,
	leasePersons,
	leaseTenants,
	leaseUnits,
	leases,
	meterReadings,
	meters,
	operatingCostStatements,
	payments,
	properties,
	rentCharges,
	rentChanges,
	statementResults,
	tenants,
	units
} from './db/schema';
import { chargeEntry, ensureCharges } from './ledger';
import { assertQuota } from './quotas';

// The operating cost statements (Betriebskostenabrechnungen): loading everything the pure
// computation needs with a fixed number of queries, the draft → approved → corrected life cycle,
// and the letter printed from a frozen per-lease result. Drafts are recomputed on every view; an
// approved statement is never changed again, a correction is a new version.

type Statement = BatchItem<'sqlite'>;

export type StatementRow = typeof operatingCostStatements.$inferSelect;

/**
 * When the claim of an approved statement is due: a Nachzahlung 30 days after the statement
 * reached the tenant (not due before), a Guthaben on the date set on approval.
 */
function claimDueDate(lease: LeaseStatement, deliveredOn: IsoDate | null): IsoDate | null {
	if ((lease.posted ?? lease.balance) <= 0) return lease.dueDate;
	return deliveredOn ? addDays(deliveredOn, DUE_DAYS) : null;
}

/** The horizon for the rent charges: the period end, but never beyond the current month. */
function chargeHorizon(period: DateRange): string {
	const current = monthOf(today());
	const end = monthOf(period.end);
	return end < current ? end : current;
}

/**
 * Everything the computation needs for the property and period, read with a fixed number of
 * queries (one per table, `inArray` over ids in chunks). Queries that do not wait for each other
 * run side by side: first what depends on the property alone, then what hangs on its units, cost
 * items, circles and meters, then the leases renting one of its units only as an extra, then what
 * hangs on the leases while their rent charges are synced, and last the charges, so the paid
 * prepayments are current. Undefined when the property is not in the account.
 */
export async function loadStatementInput(
	db: Database,
	accountId: string,
	propertyId: string,
	period: DateRange
): Promise<StatementInput | undefined> {
	const [
		[property],
		unitRows,
		itemRows,
		circleRows,
		meterRows,
		categoryRows,
		keyRows,
		shareRows,
		versions,
		landlord,
		previous
	] = await Promise.all([
		db
			.select()
			.from(properties)
			.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId))),
		db
			.select()
			.from(units)
			.where(and(eq(units.accountId, accountId), eq(units.propertyId, propertyId)))
			.orderBy(asc(units.name)),
		db
			.select()
			.from(costItems)
			.where(
				and(
					eq(costItems.accountId, accountId),
					eq(costItems.propertyId, propertyId),
					lte(costItems.periodStart, period.end),
					gte(costItems.periodEnd, period.start)
				)
			)
			.orderBy(asc(costItems.periodStart), asc(costItems.createdAt)),
		db
			.select()
			.from(billingCircles)
			.where(
				and(eq(billingCircles.accountId, accountId), eq(billingCircles.propertyId, propertyId))
			),
		db
			.select()
			.from(meters)
			.where(and(eq(meters.accountId, accountId), eq(meters.propertyId, propertyId))),
		db.select().from(costCategories).where(eq(costCategories.accountId, accountId)),
		db.select().from(allocationKeys).where(eq(allocationKeys.accountId, accountId)),
		db.select().from(allocationKeyShares).where(eq(allocationKeyShares.accountId, accountId)),
		// The versions of this statement: a correction replaces their postings.
		db
			.select({ id: operatingCostStatements.id })
			.from(operatingCostStatements)
			.where(
				and(
					eq(operatingCostStatements.accountId, accountId),
					eq(operatingCostStatements.propertyId, propertyId),
					eq(operatingCostStatements.periodStart, period.start),
					eq(operatingCostStatements.periodEnd, period.end)
				)
			),
		landlordAddress(db, accountId),
		previousPeriod(db, accountId, propertyId, period.start)
	]);
	if (!property) return undefined;
	const unitIds = unitRows.map((unit) => unit.id);
	const unitIdSet = new Set(unitIds);
	const versionIds = new Set(versions.map((version) => version.id));

	// Leases whose main unit is in the property, plus leases renting one of its units as an extra.
	const [mainLeases, extraLinks, unitAmountRows, circleUnitRows, readingRows] = await Promise.all([
		selectInChunks(unitIds, (ids) =>
			db
				.select()
				.from(leases)
				.where(and(eq(leases.accountId, accountId), inArray(leases.unitId, ids)))
		),
		selectInChunks(unitIds, (ids) =>
			db
				.select()
				.from(leaseUnits)
				.where(and(eq(leaseUnits.accountId, accountId), inArray(leaseUnits.unitId, ids)))
		),
		selectInChunks(
			itemRows.map((item) => item.id),
			(ids) =>
				db
					.select()
					.from(costItemUnitAmounts)
					.where(
						and(
							eq(costItemUnitAmounts.accountId, accountId),
							inArray(costItemUnitAmounts.costItemId, ids)
						)
					)
		),
		selectInChunks(
			circleRows.map((circle) => circle.id),
			(ids) =>
				db
					.select()
					.from(billingCircleUnits)
					.where(
						and(
							eq(billingCircleUnits.accountId, accountId),
							inArray(billingCircleUnits.circleId, ids)
						)
					)
		),
		selectInChunks(
			meterRows.map((meter) => meter.id),
			(ids) =>
				db
					.select()
					.from(meterReadings)
					.where(and(eq(meterReadings.accountId, accountId), inArray(meterReadings.meterId, ids)))
					.orderBy(asc(meterReadings.readAt))
		)
	]);
	const mainIds = new Set(mainLeases.map((lease) => lease.id));
	const extraOnlyIds = [...new Set(extraLinks.map((link) => link.leaseId))].filter(
		(id) => !mainIds.has(id)
	);
	const extraLeases = await selectInChunks(extraOnlyIds, (ids) =>
		db
			.select()
			.from(leases)
			.where(and(eq(leases.accountId, accountId), inArray(leases.id, ids)))
	);
	const leaseRows = [...mainLeases, ...extraLeases].filter(
		(lease) =>
			lease.startDate <= period.end && (lease.endDate === null || lease.endDate >= period.start)
	);
	const leaseIds = leaseRows.map((lease) => lease.id);

	// The sync runs alongside the reads it does not change; the charges are read once it is done.
	const [, tenantRows, personRows, changeRows, paymentRows] = await Promise.all([
		ensureCharges(db, accountId, leaseIds, chargeHorizon(period)),
		selectInChunks(leaseIds, (ids) =>
			db
				.select({
					leaseId: leaseTenants.leaseId,
					tenant: tenants,
					joinedOn: leaseTenants.joinedOn,
					leftOn: leaseTenants.leftOn
				})
				.from(leaseTenants)
				.innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
				.where(and(eq(tenants.accountId, accountId), inArray(leaseTenants.leaseId, ids)))
				.orderBy(asc(tenants.lastName), asc(tenants.firstName))
		),
		selectInChunks(leaseIds, (ids) =>
			db
				.select()
				.from(leasePersons)
				.where(and(eq(leasePersons.accountId, accountId), inArray(leasePersons.leaseId, ids)))
		),
		selectInChunks(leaseIds, (ids) =>
			db
				.select()
				.from(rentChanges)
				.where(
					and(
						eq(rentChanges.accountId, accountId),
						inArray(rentChanges.leaseId, ids),
						eq(rentChanges.status, 'approved')
					)
				)
		),
		selectInChunks(leaseIds, (ids) =>
			db
				.select({ leaseId: payments.leaseId, date: payments.date, amount: payments.amount })
				.from(payments)
				.where(and(eq(payments.accountId, accountId), inArray(payments.leaseId, ids)))
		)
	]);
	// The whole rent account of each lease: payments settle the oldest charges first.
	const chargeRows = await selectInChunks(leaseIds, (ids) =>
		db
			.select()
			.from(rentCharges)
			.where(and(eq(rentCharges.accountId, accountId), inArray(rentCharges.leaseId, ids)))
	);

	const statementLeases: StatementLease[] = leaseRows.map((lease) => ({
		id: lease.id,
		kind: lease.kind,
		startDate: lease.startDate,
		endDate: lease.endDate,
		operatingCostModel: lease.operatingCostModel,
		heatingCostModel: lease.heatingCostModel,
		ledgerStart: lease.ledgerStart,
		unitIds: [
			...(unitIdSet.has(lease.unitId) ? [lease.unitId] : []),
			...extraLinks.filter((link) => link.leaseId === lease.id).map((link) => link.unitId)
		],
		prepaymentsElsewhere: !unitIdSet.has(lease.unitId),
		// The statement goes to the parties of today, not to a co-tenant who left the lease.
		tenants: currentParties(
			lease,
			mainFirst(
				tenantRows.filter((row) => row.leaseId === lease.id),
				lease.mainTenantId,
				(row) => row.tenant.id
			)
		).map((tenant) => ({
			salutation: tenant.salutation,
			firstName: tenant.firstName,
			lastName: tenant.lastName,
			street: tenant.street,
			postalCode: tenant.postalCode,
			city: tenant.city
		})),
		persons: personRows
			.filter((row) => row.leaseId === lease.id)
			.map((row) => ({ validFrom: row.validFrom, persons: row.persons })),
		rentHistory: changeRows
			.filter((row) => row.leaseId === lease.id)
			.map((row) => ({
				validFrom: row.validFrom,
				baseRent: row.baseRent,
				parkingRent: row.parkingRent,
				operatingCostPrepayment: row.operatingCostPrepayment,
				heatingCostPrepayment: row.heatingCostPrepayment,
				status: row.status
			})),
		charges: chargeRows
			.filter(
				(row) => row.leaseId === lease.id && !(row.referenceId && versionIds.has(row.referenceId))
			)
			.map((row): LedgerCharge => ({
				kind: row.kind,
				period: row.period,
				dueDate: row.dueDate,
				amount: row.amount,
				operatingCostPrepayment: row.operatingCostPrepayment,
				heatingCostPrepayment: row.heatingCostPrepayment
			})),
		payments: paymentRows
			.filter((row) => row.leaseId === lease.id)
			.map((row) => ({ date: row.date, amount: row.amount }))
	}));

	const statementMeters: Meter[] = meterRows.map((meter) => ({
		id: meter.id,
		unitId: meter.unitId,
		kind: meter.kind,
		unit: meter.unit,
		serialNumber: meter.serialNumber,
		installedAt: meter.installedAt,
		removedAt: meter.removedAt,
		readings: readingRows
			.filter((row) => row.meterId === meter.id)
			.map((row): Reading => ({ readAt: row.readAt, value: row.value, estimated: row.estimated }))
	}));

	return {
		property: {
			id: property.id,
			name: property.name,
			street: property.street,
			postalCode: property.postalCode,
			city: property.city,
			vacancyPersons: property.vacancyPersons,
			buildingUse: property.buildingUse
		},
		period,
		units: unitRows.map((unit) => ({
			id: unit.id,
			name: unit.name,
			kind: unit.kind,
			floorArea: unit.floorArea
		})),
		leases: statementLeases,
		items: itemRows.map((item) => ({
			id: item.id,
			description: item.description,
			supplier: item.supplier,
			categoryId: item.categoryId,
			allocationKeyId: item.allocationKeyId,
			billingCircleId: item.billingCircleId,
			periodStart: item.periodStart,
			periodEnd: item.periodEnd,
			amount: item.amount,
			allocable: item.allocable,
			fuel: item.fuel,
			fuelKwh: item.fuelKwh,
			co2Kg: item.co2Kg,
			co2Cost: item.co2Cost,
			unitAmounts: unitAmountRows
				.filter((row) => row.costItemId === item.id)
				.map((row) => ({ unitId: row.unitId, leaseId: row.leaseId, amount: row.amount })),
			association:
				item.associationTotal !== null &&
				item.associationKeyTotal !== null &&
				item.associationKeyShare !== null
					? {
							total: item.associationTotal,
							key: item.associationKey ?? 'MEA',
							keyTotal: item.associationKeyTotal,
							keyShare: item.associationKeyShare
						}
					: null
		})),
		categories: categoryRows.map((category) => ({
			id: category.id,
			name: category.name,
			betrkvItem: category.betrkvItem,
			allocable: category.allocable,
			consumptionBased: category.consumptionBased
		})),
		keys: keyRows
			.filter((key) => key.propertyId === null || key.propertyId === propertyId)
			.map((key) => ({
				id: key.id,
				name: key.name,
				kind: key.kind,
				meterKind: key.meterKind,
				consumptionPercent: key.consumptionPercent,
				shares: shareRows
					.filter((row) => row.keyId === key.id)
					.map((row) => ({ unitId: row.unitId, share: row.share }))
			})),
		circles: circleRows.map((circle) => ({
			id: circle.id,
			name: circle.name,
			unitIds: circleUnitRows.filter((row) => row.circleId === circle.id).map((row) => row.unitId)
		})),
		meters: statementMeters,
		landlord: {
			name: landlord.name,
			street: landlord.street,
			postalCode: landlord.postalCode,
			city: landlord.city,
			iban: landlord.iban,
			bankName: landlord.bankName
		},
		previous
	};
}

/**
 * The allocable Gesamtkosten per Kostenart of the property's last approved statement that ends
 * before `start` (its newest version), for the Vorjahresvergleich; undefined when there is none.
 */
async function previousPeriod(
	db: Database,
	accountId: string,
	propertyId: string,
	start: IsoDate
): Promise<PreviousPeriod | undefined> {
	const [row] = await db
		.select({
			periodStart: operatingCostStatements.periodStart,
			periodEnd: operatingCostStatements.periodEnd,
			result: operatingCostStatements.result
		})
		.from(operatingCostStatements)
		.where(
			and(
				eq(operatingCostStatements.accountId, accountId),
				eq(operatingCostStatements.propertyId, propertyId),
				eq(operatingCostStatements.status, 'approved'),
				lt(operatingCostStatements.periodEnd, start)
			)
		)
		.orderBy(desc(operatingCostStatements.periodEnd), desc(operatingCostStatements.version))
		.limit(1);
	if (!row?.result) return undefined;
	const totals = new Map<string, number>();
	for (const item of (JSON.parse(row.result) as PropertyResult).items) {
		if (item.allocable)
			totals.set(item.categoryName, (totals.get(item.categoryName) ?? 0) + item.total);
	}
	return {
		start: row.periodStart,
		end: row.periodEnd,
		categories: [...totals].map(([name, total]) => ({ name, total }))
	};
}

// Listing

export type StatementListEntry = {
	id: string;
	propertyId: string;
	propertyName: string;
	periodStart: IsoDate;
	periodEnd: IsoDate;
	periodLabel: string;
	version: number;
	status: StatementRow['status'];
	correctsId: string | null;
	/** An approved correction of this statement exists. */
	superseded: boolean;
	costsTotal: number;
	allocableTotal: number;
	leaseCount: number;
	nachzahlungen: number;
	guthaben: number;
	approvedAt: Date | null;
	createdAt: Date;
};

export type StatementGroup = {
	property: { id: string; name: string };
	statements: StatementListEntry[];
};

function parseProperty(row: Pick<StatementRow, 'result'>): PropertyResult | undefined {
	if (!row.result) return undefined;
	return JSON.parse(row.result) as PropertyResult;
}

/** The statements of the account grouped by property, newest period and version first. */
export async function listStatements(db: Database, accountId: string): Promise<StatementGroup[]> {
	const rows = await db
		.select({ statement: operatingCostStatements, propertyName: properties.name })
		.from(operatingCostStatements)
		.innerJoin(properties, eq(operatingCostStatements.propertyId, properties.id))
		.where(eq(operatingCostStatements.accountId, accountId))
		.orderBy(
			asc(properties.name),
			desc(operatingCostStatements.periodStart),
			desc(operatingCostStatements.version)
		);
	const supersededIds = new Set(
		rows
			.filter((row) => row.statement.status === 'approved' && row.statement.correctsId)
			.map((row) => row.statement.correctsId!)
	);
	// A draft is computed from the current inputs, as its page shows it; only an approved statement
	// has a stored result.
	const drafts = new Map(
		await Promise.all(
			rows
				.filter((row) => row.statement.status === 'draft')
				.map(
					async ({ statement }) =>
						[statement.id, (await computeDraft(db, accountId, statement))?.property] as const
				)
		)
	);
	const groups: StatementGroup[] = [];
	for (const { statement, propertyName } of rows) {
		const result =
			statement.status === 'draft' ? drafts.get(statement.id) : parseProperty(statement);
		const entry: StatementListEntry = {
			id: statement.id,
			propertyId: statement.propertyId,
			propertyName,
			periodStart: statement.periodStart,
			periodEnd: statement.periodEnd,
			periodLabel: periodLabel(statement.periodStart, statement.periodEnd),
			version: statement.version,
			status: statement.status,
			correctsId: statement.correctsId,
			superseded: supersededIds.has(statement.id),
			costsTotal: result?.costsTotal ?? 0,
			allocableTotal: result?.allocableTotal ?? 0,
			leaseCount: result?.leaseCount ?? 0,
			nachzahlungen: result?.nachzahlungen ?? 0,
			guthaben: result?.guthaben ?? 0,
			approvedAt: statement.approvedAt,
			createdAt: statement.createdAt
		};
		const group = groups.at(-1);
		if (group && group.property.id === statement.propertyId) group.statements.push(entry);
		else
			groups.push({
				property: { id: statement.propertyId, name: propertyName },
				statements: [entry]
			});
	}
	return groups;
}

/** The properties of the account, with whether cost items exist for them (the form needs one). */
export async function listPropertiesForStatements(
	db: Database,
	accountId: string
): Promise<{ id: string; name: string; hasCostItems: boolean }[]> {
	const [propertyRows, itemRows] = await Promise.all([
		db
			.select({ id: properties.id, name: properties.name })
			.from(properties)
			.where(eq(properties.accountId, accountId))
			.orderBy(asc(properties.name)),
		db
			.selectDistinct({ propertyId: costItems.propertyId })
			.from(costItems)
			.where(eq(costItems.accountId, accountId))
	]);
	const withItems = new Set(itemRows.map((row) => row.propertyId));
	return propertyRows.map((property) => ({
		...property,
		hasCostItems: withItems.has(property.id)
	}));
}

// One statement

export type LeaseResultRow = {
	leaseId: string;
	balance: number;
	deliveredOn: IsoDate | null;
	/**
	 * When the claim is due: a Nachzahlung 30 days after the delivery (null before it), a Guthaben
	 * 30 days after the approval.
	 */
	dueDate: IsoDate | null;
	/** § 556 Abs. 3 Satz 5 BGB: the end of the twelfth month after the delivery. */
	objectionDeadline: IsoDate | null;
	/** The Nachzahlung taken back because the statement reached the tenant too late, cents. */
	reversedOnDelivery: number;
	/** The lease still runs (or ends in the future), so a prepayment adjustment makes sense. */
	active: boolean;
};

export type StatementView = {
	statement: StatementRow;
	property: { id: string; name: string };
	periodLabel: string;
	/** Recomputed for a draft, the frozen one for an approved statement. */
	result: StatementResult;
	/** The statement_results rows of an approved statement (empty for a draft). */
	leaseResults: LeaseResultRow[];
	/** The warnings that stop the approval. */
	blocking: StatementWarning[];
	/** The correction of this statement, when one exists (draft or approved). */
	correctedBy: { id: string; version: number; status: StatementRow['status'] } | null;
	/** The statement this one corrects. */
	corrects: { id: string; version: number } | null;
	superseded: boolean;
};

/** Whether the statement exists in the account; the page actions answer 404 otherwise. */
export async function statementExists(
	db: Database,
	accountId: string,
	id: string
): Promise<boolean> {
	return Boolean(await statementRow(db, accountId, id));
}

async function statementRow(db: Database, accountId: string, id: string) {
	const [row] = await db
		.select()
		.from(operatingCostStatements)
		.where(
			and(eq(operatingCostStatements.accountId, accountId), eq(operatingCostStatements.id, id))
		);
	return row;
}

type ChargeRow = typeof rentCharges.$inferSelect;

/** Every ledger posting that carries the statement's id as its reference. */
async function chargesOfStatement(
	db: Database,
	accountId: string,
	statementId: string
): Promise<ChargeRow[]> {
	return db
		.select()
		.from(rentCharges)
		.where(and(eq(rentCharges.accountId, accountId), eq(rentCharges.referenceId, statementId)));
}

/**
 * The statement's own balance postings, and the reversals of them made because the statement
 * reached the tenant after the deadline. A correction's reversals of its predecessor's postings
 * carry the correction's id too, but reverse postings of another statement.
 */
function splitCharges(rows: readonly ChargeRow[]) {
	const originals = rows.filter((row) => row.reversesChargeId === null);
	const originalIds = new Set(originals.map((row) => row.id));
	const deliveryReversals = rows.filter(
		(row) => row.reversesChargeId !== null && originalIds.has(row.reversesChargeId)
	);
	return { originals, deliveryReversals };
}

async function deliveryReversals(
	db: Database,
	accountId: string,
	statementId: string
): Promise<ChargeRow[]> {
	return splitCharges(await chargesOfStatement(db, accountId, statementId)).deliveryReversals;
}

/** What the statement still claims per lease: its postings net of the delivery reversals. */
function netClaims(rows: readonly ChargeRow[]): Map<string, number> {
	const { originals, deliveryReversals } = splitCharges(rows);
	const claims = new Map<string, number>();
	for (const row of [...originals, ...deliveryReversals]) {
		claims.set(row.leaseId, (claims.get(row.leaseId) ?? 0) + row.amount);
	}
	return claims;
}

async function correctionOf(db: Database, accountId: string, id: string) {
	const [row] = await db
		.select({
			id: operatingCostStatements.id,
			version: operatingCostStatements.version,
			status: operatingCostStatements.status
		})
		.from(operatingCostStatements)
		.where(
			and(
				eq(operatingCostStatements.accountId, accountId),
				eq(operatingCostStatements.correctsId, id)
			)
		)
		.orderBy(desc(operatingCostStatements.version));
	return row ?? null;
}

async function computeDraft(
	db: Database,
	accountId: string,
	row: StatementRow,
	options: StatementOptions = {}
): Promise<StatementResult | undefined> {
	const input = await loadStatementInput(db, accountId, row.propertyId, {
		start: row.periodStart,
		end: row.periodEnd
	});
	return input && computeStatement(input, options);
}

/** The statement with its result: recomputed for a draft, frozen for an approved one. */
export async function getStatement(
	db: Database,
	accountId: string,
	id: string
): Promise<StatementView | undefined> {
	const row = await statementRow(db, accountId, id);
	if (!row) return undefined;
	// Everything else hangs on the row alone, so it is read side by side.
	const [[property], view, correctedBy, corrects] = await Promise.all([
		db
			.select({ id: properties.id, name: properties.name })
			.from(properties)
			.where(and(eq(properties.accountId, accountId), eq(properties.id, row.propertyId))),
		viewResult(db, accountId, row),
		correctionOf(db, accountId, id),
		row.correctsId
			? db
					.select({ id: operatingCostStatements.id, version: operatingCostStatements.version })
					.from(operatingCostStatements)
					.where(
						and(
							eq(operatingCostStatements.accountId, accountId),
							eq(operatingCostStatements.id, row.correctsId)
						)
					)
					.then((rows) => rows[0] ?? null)
			: Promise.resolve(null)
	]);
	if (!property || !view) return undefined;
	const { result, leaseResults } = view;
	return {
		statement: row,
		property,
		periodLabel: periodLabel(row.periodStart, row.periodEnd),
		result,
		leaseResults,
		blocking: result.property.warnings.filter((warning) => warning.blocking),
		correctedBy,
		corrects,
		superseded: correctedBy?.status === 'approved'
	};
}

/**
 * The result of the statement: recomputed for a draft, frozen for an approved one with where each
 * lease's claim stands; undefined when there is none.
 */
async function viewResult(
	db: Database,
	accountId: string,
	row: StatementRow
): Promise<{ result: StatementResult; leaseResults: LeaseResultRow[] } | undefined> {
	if (row.status !== 'approved') {
		const result = await computeDraft(db, accountId, row);
		return result && { result, leaseResults: [] };
	}
	const propertyResult = parseProperty(row);
	if (!propertyResult) return undefined;
	const [rows, reversals] = await Promise.all([
		db
			.select({
				entry: statementResults,
				lease: { id: leases.id, endDate: leases.endDate }
			})
			.from(statementResults)
			.leftJoin(
				leases,
				and(eq(leases.accountId, accountId), eq(leases.id, statementResults.leaseId))
			)
			.where(
				and(eq(statementResults.accountId, accountId), eq(statementResults.statementId, row.id))
			)
			.orderBy(asc(statementResults.createdAt), asc(statementResults.id)),
		deliveryReversals(db, accountId, row.id)
	]);
	const frozenLeases = rows.map(({ entry }) => JSON.parse(entry.result) as LeaseStatement);
	const day = today();
	const leaseResults = rows.map(({ entry, lease }, index) => ({
		leaseId: entry.leaseId,
		balance: entry.balance,
		deliveredOn: entry.deliveredOn,
		dueDate: claimDueDate(frozenLeases[index], entry.deliveredOn),
		objectionDeadline: entry.deliveredOn ? objectionDeadline(entry.deliveredOn) : null,
		reversedOnDelivery:
			0 - (reversals.find((charge) => charge.leaseId === entry.leaseId)?.amount ?? 0),
		active: Boolean(lease) && (lease!.endDate === null || lease!.endDate >= day)
	}));
	return { result: { property: propertyResult, leases: frozenLeases }, leaseResults };
}

/** The frozen per-lease result of an approved statement, for the PDF; undefined otherwise. */
export async function getLeaseResult(
	db: Database,
	accountId: string,
	statementId: string,
	leaseId: string
): Promise<LeaseStatement | undefined> {
	const [row] = await db
		.select({ result: statementResults.result, status: operatingCostStatements.status })
		.from(statementResults)
		.innerJoin(
			operatingCostStatements,
			eq(statementResults.statementId, operatingCostStatements.id)
		)
		.where(
			and(
				eq(statementResults.accountId, accountId),
				eq(statementResults.statementId, statementId),
				eq(statementResults.leaseId, leaseId)
			)
		);
	if (!row || row.status !== 'approved') return undefined;
	return JSON.parse(row.result) as LeaseStatement;
}

// Life cycle

export type StatementOutcome = { ok: true; id: string } | { ok: false; message: string };

function statementName(label: string, propertyName: string): string {
	return `Betriebskostenabrechnung ${label} für ${propertyName}`;
}

/** The name of the property of the account, for the audit entry; undefined when there is none. */
async function nameOfProperty(
	db: Database,
	accountId: string,
	propertyId: string
): Promise<string | undefined> {
	const [row] = await db
		.select({ name: properties.name })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	return row?.name;
}

/** Creates a draft for the property and period; its result is computed whenever it is shown. */
export async function createStatement(
	db: Database,
	context: AuditContext,
	input: { propertyId: string; periodStart: IsoDate; periodEnd: IsoDate }
): Promise<StatementOutcome> {
	const { accountId } = context;
	const periodError = validatePeriod(input.periodStart, input.periodEnd);
	if (periodError) return { ok: false, message: periodError };
	// Every statement of the property whose period touches the new one: the same period is
	// corrected instead, an overlapping one would settle the shared months twice.
	const [overlapping, propertyName] = await Promise.all([
		db
			.select({
				id: operatingCostStatements.id,
				status: operatingCostStatements.status,
				periodStart: operatingCostStatements.periodStart,
				periodEnd: operatingCostStatements.periodEnd
			})
			.from(operatingCostStatements)
			.where(
				and(
					eq(operatingCostStatements.accountId, accountId),
					eq(operatingCostStatements.propertyId, input.propertyId),
					lte(operatingCostStatements.periodStart, input.periodEnd),
					gte(operatingCostStatements.periodEnd, input.periodStart)
				)
			)
			.orderBy(asc(operatingCostStatements.periodStart)),
		nameOfProperty(db, accountId, input.propertyId)
	]);
	const existing = overlapping.find(
		(row) => row.periodStart === input.periodStart && row.periodEnd === input.periodEnd
	);
	if (existing) {
		return {
			ok: false,
			message:
				existing.status === 'draft'
					? 'Für dieses Objekt und diesen Zeitraum gibt es schon einen Entwurf.'
					: 'Für dieses Objekt und diesen Zeitraum gibt es schon eine freigegebene Abrechnung; erstelle dort eine Korrektur.'
		};
	}
	if (overlapping.length > 0) {
		const other = overlapping[0];
		return {
			ok: false,
			message: `Der Zeitraum überschneidet sich mit der Abrechnung ${periodLabel(other.periodStart, other.periodEnd)} (${other.status === 'draft' ? 'Entwurf' : 'freigegeben'}); jeder Monat darf nur einmal abgerechnet werden.`
		};
	}
	if (propertyName === undefined) return { ok: false, message: 'Dieses Objekt gibt es nicht.' };
	await assertQuota(db, accountId, 'operatingCostStatements');

	const id = crypto.randomUUID();
	const label = periodLabel(input.periodStart, input.periodEnd);
	await runBatch(db, [
		db.insert(operatingCostStatements).values({
			id,
			accountId,
			propertyId: input.propertyId,
			periodStart: input.periodStart,
			periodEnd: input.periodEnd,
			version: 1,
			status: 'draft'
		}),
		auditEntry(
			db,
			context,
			'statement',
			id,
			'create',
			`${statementName(label, propertyName)} als Entwurf angelegt`
		)
	]);
	return { ok: true, id };
}

export type ApprovalInput = {
	/** § 556 Abs. 3 BGB: the landlord is not responsible for the late statement. */
	lateApprovalJustified: boolean;
	note: string | null;
};

/**
 * Approves a draft once its period has ended: freezes the results, posts one `statement_balance`
 * charge per lease (the Nachzahlung of a residential lease after the deadline only with
 * `lateApprovalJustified`) and, for a correction, the reversal of the corrected statement's
 * charges, all in one batch with the audit entry. `options.today` approves on an earlier day, as
 * the demo data does for the statements of past years.
 */
export async function approveStatement(
	db: Database,
	context: AuditContext,
	id: string,
	input: ApprovalInput,
	options: StatementOptions = {}
): Promise<StatementOutcome> {
	const approvedOn = options.today ?? today();
	const { accountId } = context;
	const row = await statementRow(db, accountId, id);
	if (!row) return { ok: false, message: 'Diese Abrechnung gibt es nicht.' };
	if (row.status === 'approved') {
		return { ok: false, message: 'Diese Abrechnung ist schon freigegeben.' };
	}
	// The prepayments of months still to come are not charged yet; they would count as unpaid.
	if (row.periodEnd >= approvedOn) {
		return {
			ok: false,
			message: `Der Abrechnungszeitraum endet am ${formatDate(row.periodEnd)}; freigeben kannst du die Abrechnung erst danach.`
		};
	}
	const [result, previous] = await Promise.all([
		computeDraft(db, accountId, row, { today: approvedOn }),
		row.correctsId ? chargesOfStatement(db, accountId, row.correctsId) : Promise.resolve([])
	]);
	if (!result) return { ok: false, message: 'Dieses Objekt gibt es nicht.' };
	const blocking = result.property.warnings.filter((warning) => warning.blocking);
	if (blocking.length > 0) {
		return {
			ok: false,
			message: `Die Abrechnung kann noch nicht freigegeben werden: ${blocking[0].message}`
		};
	}
	if (result.property.late && input.lateApprovalJustified && !input.note) {
		return {
			ok: false,
			message: 'Bitte begründe, warum du die Verspätung nicht zu vertreten hast.'
		};
	}

	const creditDue = addDays(approvedOn, DUE_DAYS);
	const period = monthOf(row.periodEnd);
	const label = periodLabel(row.periodStart, row.periodEnd);
	const name = statementName(label, result.property.propertyName);
	const statements: Statement[] = [];

	// A correction takes the corrected statement's postings back first (as far as a late delivery
	// has not taken them back already), each due when the posting it cancels is, and remembers
	// what that statement still posts per lease.
	let previousPostings = new Map<string, number>();
	if (row.correctsId) {
		previousPostings = netClaims(previous);
		const { originals, deliveryReversals: reversed } = splitCharges(previous);
		for (const charge of originals) {
			const taken = reversed.filter((entry) => entry.reversesChargeId === charge.id);
			const rest = taken.reduce((sum, entry) => sum + entry.amount, charge.amount);
			if (taken.length > 0 && rest === 0) continue;
			statements.push(
				chargeEntry(db, context, {
					leaseId: charge.leaseId,
					kind: 'statement_balance',
					period,
					dueDate: charge.dueDate,
					amount: -rest,
					referenceId: id,
					reversesChargeId: charge.id,
					note: `Storno durch Korrektur der Betriebskostenabrechnung ${label}`
				}).statement
			);
		}
	}

	// The postings of the claims, with § 556 Abs. 3 BGB after the deadline: see approveLease.
	const frozen: LeaseStatement[] = result.leases.map((lease) =>
		approveLease(lease, approvedOn, {
			lateApprovalJustified: input.lateApprovalJustified,
			previousPosting: previousPostings.get(lease.leaseId) ?? 0
		})
	);
	const propertyResult: PropertyResult = { ...result.property, approvedOn };

	const resultRows = frozen.map((lease) => ({
		id: crypto.randomUUID(),
		accountId,
		statementId: id,
		leaseId: lease.leaseId,
		balance: lease.balance,
		result: JSON.stringify(lease)
	}));
	for (const lease of frozen) {
		const posted = lease.posted ?? lease.balance;
		const amount = posted - lease.unpaidPrepayments;
		statements.push(
			chargeEntry(db, context, {
				leaseId: lease.leaseId,
				kind: 'statement_balance',
				period,
				dueDate: amount > 0 ? null : creditDue,
				amount,
				referenceId: id,
				note: postingNote(label, lease, posted)
			}).statement
		);
	}
	await Promise.all([
		assertQuota(db, accountId, 'statementResults', resultRows.length),
		assertQuota(db, accountId, 'rentCharges', statements.length)
	]);

	await runBatch(db, [
		db
			.update(operatingCostStatements)
			.set({
				status: 'approved',
				result: JSON.stringify(propertyResult),
				lateApprovalJustified: input.lateApprovalJustified,
				note: input.note,
				approvedAt: options.today ? new Date(`${approvedOn}T10:00:00Z`) : new Date(),
				approvedBy: context.userId
			})
			.where(
				and(
					eq(operatingCostStatements.accountId, accountId),
					eq(operatingCostStatements.id, id),
					eq(operatingCostStatements.status, 'draft')
				)
			),
		...chunk(resultRows, rowsPerStatement(statementResults)).map((rows) =>
			db.insert(statementResults).values(rows)
		),
		...statements,
		auditEntry(
			db,
			context,
			'statement',
			id,
			'approve',
			`${name} freigegeben: ${pluralize(frozen.length, 'Mietvertrag', 'Mietverträge')}, Nachzahlungen ${formatCents(propertyResult.nachzahlungen)}, Guthaben ${formatCents(propertyResult.guthaben)}`
		)
	]);
	return { ok: true, id };
}

function postingNote(label: string, lease: LeaseStatement, posted: number): string {
	const parts = [`Betriebskostenabrechnung ${label}`];
	if (posted < lease.balance) {
		parts.push(
			posted === 0
				? `Nachzahlung ${formatCents(lease.balance)} nach Ablauf der Abrechnungsfrist nicht verlangt (§ 556 Abs. 3 BGB)`
				: `Ergebnis ${formatCents(lease.balance)} nach Ablauf der Abrechnungsfrist auf ${formatCents(posted)} begrenzt (§ 556 Abs. 3 BGB)`
		);
	}
	if (lease.unpaidPrepayments > 0) {
		parts.push(
			`abzüglich ${formatCents(lease.unpaidPrepayments)} nicht geleisteter Vorauszahlungen, die schon als Soll gebucht sind`
		);
	}
	if (posted - lease.unpaidPrepayments > 0) parts.push('fällig 30 Tage nach Zugang');
	return parts.join('; ');
}

/** A new draft version that corrects the approved statement. */
export async function createCorrection(
	db: Database,
	context: AuditContext,
	id: string
): Promise<StatementOutcome> {
	const { accountId } = context;
	const row = await statementRow(db, accountId, id);
	if (!row) return { ok: false, message: 'Diese Abrechnung gibt es nicht.' };
	if (row.status !== 'approved') {
		return { ok: false, message: 'Nur eine freigegebene Abrechnung kann korrigiert werden.' };
	}
	const [existing, propertyName, [latest]] = await Promise.all([
		correctionOf(db, accountId, id),
		nameOfProperty(db, accountId, row.propertyId),
		db
			.select({ version: operatingCostStatements.version })
			.from(operatingCostStatements)
			.where(
				and(
					eq(operatingCostStatements.accountId, accountId),
					eq(operatingCostStatements.propertyId, row.propertyId),
					eq(operatingCostStatements.periodStart, row.periodStart),
					eq(operatingCostStatements.periodEnd, row.periodEnd)
				)
			)
			.orderBy(desc(operatingCostStatements.version))
	]);
	if (existing) {
		return {
			ok: false,
			message:
				existing.status === 'draft'
					? 'Zu dieser Abrechnung gibt es schon einen Korrekturentwurf.'
					: 'Diese Abrechnung wurde schon korrigiert; korrigiere die neueste Version.'
		};
	}
	if (propertyName === undefined) return { ok: false, message: 'Dieses Objekt gibt es nicht.' };
	const version = (latest?.version ?? row.version) + 1;
	await assertQuota(db, accountId, 'operatingCostStatements');
	const correctionId = crypto.randomUUID();
	const label = periodLabel(row.periodStart, row.periodEnd);
	await runBatch(db, [
		db.insert(operatingCostStatements).values({
			id: correctionId,
			accountId,
			propertyId: row.propertyId,
			periodStart: row.periodStart,
			periodEnd: row.periodEnd,
			version,
			status: 'draft',
			correctsId: id
		}),
		auditEntry(
			db,
			context,
			'statement',
			correctionId,
			'correct',
			`Korrektur (Version ${version}) der ${statementName(label, propertyName)} als Entwurf angelegt`
		)
	]);
	return { ok: true, id: correctionId };
}

export type DeliveryOutcome =
	| {
			ok: true;
			/** The Nachzahlung taken back because of a late delivery, cents. */ reversed: number;
	  }
	| { ok: false; message: string };

/**
 * Records when the statement reached the tenant; starts the Einwendungsfrist and makes the
 * Nachzahlung due 30 days later. § 556 Abs. 3 BGB turns on the receipt: a residential Nachzahlung
 * that reaches the tenant after the deadline is excluded, so its posting is reversed in the same
 * batch (unless the landlord declared the delay not his fault on approval). A correction whose
 * corrected version had reached the tenant in time keeps what that version still claims; only
 * the excess is reversed. The posting holds only what exceeds the unpaid prepayments, which stay
 * claimable (BGH VIII ZR 261/06).
 */
export async function setDelivered(
	db: Database,
	context: AuditContext,
	statementId: string,
	leaseId: string,
	date: IsoDate
): Promise<DeliveryOutcome> {
	const { accountId } = context;
	const [row] = await db
		.select({
			id: statementResults.id,
			result: statementResults.result,
			periodStart: operatingCostStatements.periodStart,
			periodEnd: operatingCostStatements.periodEnd,
			correctsId: operatingCostStatements.correctsId,
			lateApprovalJustified: operatingCostStatements.lateApprovalJustified
		})
		.from(statementResults)
		.innerJoin(
			operatingCostStatements,
			eq(statementResults.statementId, operatingCostStatements.id)
		)
		.where(
			and(
				eq(statementResults.accountId, accountId),
				eq(statementResults.statementId, statementId),
				eq(statementResults.leaseId, leaseId)
			)
		);
	if (!row) return { ok: false, message: 'Zu diesem Mietvertrag gibt es kein Ergebnis.' };
	const lease = JSON.parse(row.result) as LeaseStatement;
	if (lease.approvedOn && date < lease.approvedOn) {
		return {
			ok: false,
			message: `Die Abrechnung wurde am ${formatDate(lease.approvedOn)} freigegeben; sie kann nicht vorher zugestellt worden sein.`
		};
	}
	if (date > today()) {
		return { ok: false, message: 'Das Datum der Zustellung liegt in der Zukunft.' };
	}

	const label = periodLabel(row.periodStart, row.periodEnd);
	const [own, corrected] = await Promise.all([
		chargesOfStatement(db, accountId, statementId),
		row.correctsId
			? db
					.select({ deliveredOn: statementResults.deliveredOn })
					.from(statementResults)
					.where(
						and(
							eq(statementResults.accountId, accountId),
							eq(statementResults.statementId, row.correctsId),
							eq(statementResults.leaseId, leaseId)
						)
					)
			: Promise.resolve([])
	]);
	const charges = own.filter((charge) => charge.leaseId === leaseId);
	const { originals, deliveryReversals: reversals } = splitCharges(charges);
	const posting = originals[0];
	if (reversals.length > 0 && date <= lease.deadline) {
		return {
			ok: false,
			message: `Die Nachzahlung wurde wegen der Zustellung nach dem ${formatDate(lease.deadline)} schon storniert; ein früheres Zustelldatum lässt sich nicht mehr eintragen.`
		};
	}

	// After the deadline the tenant owes no more than what reached him in time: a correction what
	// its corrected version still claims, once that version reached him in time, otherwise
	// nothing. Only the excess of the posting over that is reversed.
	let excess = 0;
	if (
		lease.leaseKind === 'residential' &&
		date > lease.deadline &&
		!row.lateApprovalJustified &&
		posting !== undefined &&
		posting.amount > 0 &&
		lease.balance > 0 &&
		reversals.length === 0
	) {
		const correctedInTime = corrected.some(
			(entry) => entry.deliveredOn !== null && entry.deliveredOn <= lease.deadline
		);
		const claimedInTime = correctedInTime
			? (netClaims(await chargesOfStatement(db, accountId, row.correctsId!)).get(leaseId) ?? 0)
			: 0;
		excess = Math.max(0, posting.amount - claimedInTime);
	}
	// A posting to pay falls due 30 days after the delivery; the rows that cancel it follow it.
	const claimDue = addDays(date, DUE_DAYS);
	const statements: Statement[] = [];
	if (posting && posting.amount > 0) {
		statements.push(
			db
				.update(rentCharges)
				.set({ dueDate: claimDue })
				.where(
					and(
						eq(rentCharges.accountId, accountId),
						or(eq(rentCharges.id, posting.id), eq(rentCharges.reversesChargeId, posting.id))
					)
				)
		);
	}
	let reversed = 0;
	if (excess > 0) {
		// Not for a posting an approved correction has reversed already.
		const [taken] = await db
			.select({ id: rentCharges.id })
			.from(rentCharges)
			.where(
				and(eq(rentCharges.accountId, accountId), eq(rentCharges.reversesChargeId, posting.id))
			);
		if (!taken) {
			await assertQuota(db, accountId, 'rentCharges');
			reversed = excess;
			const kept = posting.amount - excess;
			statements.push(
				chargeEntry(db, context, {
					leaseId,
					kind: 'statement_balance',
					period: posting.period,
					dueDate: claimDue,
					amount: -excess,
					referenceId: statementId,
					reversesChargeId: posting.id,
					note:
						`Storno: Betriebskostenabrechnung ${label} erst am ${formatDate(date)} zugestellt, nach Ablauf der Abrechnungsfrist am ${formatDate(lease.deadline)}; ` +
						(kept === 0
							? 'die Nachzahlung ist ausgeschlossen (§ 556 Abs. 3 BGB)'
							: `die Nachzahlung ist in Höhe von ${formatCents(excess)} ausgeschlossen, um die sie über die rechtzeitig zugegangene Fassung hinausgeht (§ 556 Abs. 3 BGB)`)
				}).statement
			);
		}
	}
	await runBatch(db, [
		db
			.update(statementResults)
			.set({ deliveredOn: date })
			.where(and(eq(statementResults.accountId, accountId), eq(statementResults.id, row.id))),
		...statements,
		auditEntry(
			db,
			context,
			'statement',
			statementId,
			'update',
			`Betriebskostenabrechnung ${label} für ${leaseLabel(lease.units, lease.tenants)} am ${formatDate(date)} zugestellt` +
				(reversed > 0
					? `; Nachzahlung ${formatCents(reversed)} nach Ablauf der Abrechnungsfrist storniert`
					: '')
		)
	]);
	return { ok: true, reversed };
}

/** Deletes a draft. Approved statements stay; they are corrected instead. */
export async function deleteDraft(
	db: Database,
	context: AuditContext,
	id: string
): Promise<boolean> {
	const { accountId } = context;
	const row = await statementRow(db, accountId, id);
	if (!row || row.status !== 'draft') return false;
	const propertyName = await nameOfProperty(db, accountId, row.propertyId);
	const label = periodLabel(row.periodStart, row.periodEnd);
	await runBatch(db, [
		db
			.delete(operatingCostStatements)
			.where(
				and(
					eq(operatingCostStatements.accountId, accountId),
					eq(operatingCostStatements.id, id),
					eq(operatingCostStatements.status, 'draft')
				)
			),
		auditEntry(
			db,
			context,
			'statement',
			id,
			'delete',
			`Entwurf der ${statementName(label, propertyName ?? '')} gelöscht`
		)
	]);
	return true;
}
