import { and, asc, desc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
	addDays,
	formatDate,
	formatMonth,
	monthOf,
	today,
	type DateRange,
	type IsoDate
} from '../dates';
import type { Meter, Reading } from '../domain/consumption';
import {
	balanceLabel,
	computeStatement,
	leaseLabel,
	objectionDeadline,
	periodLabel,
	validatePeriod,
	type LeaseStatement,
	type LedgerCharge,
	type PropertyResult,
	type StatementInput,
	type StatementLease,
	type StatementOptions,
	type StatementResult,
	type StatementWarning
} from '../domain/statement';
import { formatArea, formatNumber, personName, pluralize } from '../format';
import { formatCents } from '../money';
import { landlordAddress } from './accounts';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { chunk, chunkIds, rowsPerStatement, runBatch } from './db/batch';
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
import type { Letter, PdfTable } from './pdf';
import { assertQuota } from './quotas';

// The operating cost statements (Betriebskostenabrechnungen): loading everything the pure
// computation needs with a fixed number of queries, the draft → approved → corrected life cycle,
// and the letter printed from a frozen per-lease result. Drafts are recomputed on every view; an
// approved statement is never changed again, a correction is a new version.

type Statement = BatchItem<'sqlite'>;

/**
 * A Nachzahlung is due this many days after the statement reached the tenant (decided on
 * 21.10.2026), a Guthaben this many days after the approval.
 */
export const DUE_DAYS = 30;

export type StatementRow = typeof operatingCostStatements.$inferSelect;

/**
 * When the claim of an approved statement is due: a Nachzahlung 30 days after the statement
 * reached the tenant (not due before), a Guthaben on the date set on approval.
 */
function claimDueDate(lease: LeaseStatement, deliveredOn: IsoDate | null): IsoDate | null {
	if ((lease.posted ?? lease.balance) <= 0) return lease.dueDate;
	return deliveredOn ? addDays(deliveredOn, DUE_DAYS) : null;
}

/** Runs one query per chunk of ids and concatenates the rows; no query at all without ids. */
async function chunked<T, I>(ids: readonly I[], query: (ids: I[]) => Promise<T[]>): Promise<T[]> {
	const groups = await Promise.all(chunkIds(ids).map((group) => query(group)));
	return groups.flat();
}

/** The horizon for the rent charges: the period end, but never beyond the current month. */
function chargeHorizon(period: DateRange): string {
	const current = monthOf(today());
	const end = monthOf(period.end);
	return end < current ? end : current;
}

/**
 * Everything the computation needs for the property and period, read with a fixed number of
 * queries (one per table, `inArray` over ids in chunks). Undefined when the property is not in
 * the account. Rent charges of the leases are synced first, so the paid prepayments are current.
 */
export async function loadStatementInput(
	db: Database,
	accountId: string,
	propertyId: string,
	period: DateRange
): Promise<StatementInput | undefined> {
	const [property] = await db
		.select()
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	if (!property) return undefined;

	const unitRows = await db
		.select()
		.from(units)
		.where(and(eq(units.accountId, accountId), eq(units.propertyId, propertyId)))
		.orderBy(asc(units.name));
	const unitIds = unitRows.map((unit) => unit.id);
	const unitIdSet = new Set(unitIds);

	// Leases whose main unit is in the property, plus leases renting one of its units as an extra.
	const [mainLeases, extraLinks] = await Promise.all([
		chunked(unitIds, (ids) =>
			db
				.select()
				.from(leases)
				.where(and(eq(leases.accountId, accountId), inArray(leases.unitId, ids)))
		),
		chunked(unitIds, (ids) =>
			db
				.select()
				.from(leaseUnits)
				.where(and(eq(leaseUnits.accountId, accountId), inArray(leaseUnits.unitId, ids)))
		)
	]);
	const mainIds = new Set(mainLeases.map((lease) => lease.id));
	const extraOnlyIds = [...new Set(extraLinks.map((link) => link.leaseId))].filter(
		(id) => !mainIds.has(id)
	);
	const extraLeases = await chunked(extraOnlyIds, (ids) =>
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

	await ensureCharges(db, accountId, leaseIds, chargeHorizon(period));

	const [tenantRows, personRows, changeRows, chargeRows, paymentRows, versions] = await Promise.all(
		[
			chunked(leaseIds, (ids) =>
				db
					.select({ leaseId: leaseTenants.leaseId, tenant: tenants })
					.from(leaseTenants)
					.innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
					.where(and(eq(tenants.accountId, accountId), inArray(leaseTenants.leaseId, ids)))
					.orderBy(asc(tenants.lastName), asc(tenants.firstName))
			),
			chunked(leaseIds, (ids) =>
				db
					.select()
					.from(leasePersons)
					.where(and(eq(leasePersons.accountId, accountId), inArray(leasePersons.leaseId, ids)))
			),
			chunked(leaseIds, (ids) =>
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
			// The whole rent account of each lease: payments settle the oldest charges first.
			chunked(leaseIds, (ids) =>
				db
					.select()
					.from(rentCharges)
					.where(and(eq(rentCharges.accountId, accountId), inArray(rentCharges.leaseId, ids)))
			),
			chunked(leaseIds, (ids) =>
				db
					.select({ leaseId: payments.leaseId, date: payments.date, amount: payments.amount })
					.from(payments)
					.where(and(eq(payments.accountId, accountId), inArray(payments.leaseId, ids)))
			),
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
				)
		]
	);
	const versionIds = new Set(versions.map((version) => version.id));

	const itemRows = await db
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
		.orderBy(asc(costItems.periodStart), asc(costItems.createdAt));
	const itemIds = itemRows.map((item) => item.id);

	const circleRows = await db
		.select()
		.from(billingCircles)
		.where(and(eq(billingCircles.accountId, accountId), eq(billingCircles.propertyId, propertyId)));
	const meterRows = await db
		.select()
		.from(meters)
		.where(and(eq(meters.accountId, accountId), eq(meters.propertyId, propertyId)));

	const [unitAmountRows, categoryRows, keyRows, shareRows, circleUnitRows, readingRows, landlord] =
		await Promise.all([
			chunked(itemIds, (ids) =>
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
			db.select().from(costCategories).where(eq(costCategories.accountId, accountId)),
			db.select().from(allocationKeys).where(eq(allocationKeys.accountId, accountId)),
			db.select().from(allocationKeyShares).where(eq(allocationKeyShares.accountId, accountId)),
			chunked(
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
			chunked(
				meterRows.map((meter) => meter.id),
				(ids) =>
					db
						.select()
						.from(meterReadings)
						.where(and(eq(meterReadings.accountId, accountId), inArray(meterReadings.meterId, ids)))
						.orderBy(asc(meterReadings.readAt))
			),
			landlordAddress(db, accountId)
		]);

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
		tenants: tenantRows
			.filter((row) => row.leaseId === lease.id)
			.map(({ tenant }) => ({
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
		}
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
	const groups: StatementGroup[] = [];
	for (const { statement, propertyName } of rows) {
		const result = parseProperty(statement);
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
	const [property] = await db
		.select({ id: properties.id, name: properties.name })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, row.propertyId)));
	if (!property) return undefined;

	let result: StatementResult | undefined;
	let leaseResults: LeaseResultRow[] = [];
	if (row.status === 'approved') {
		const propertyResult = parseProperty(row);
		const rows = await db
			.select()
			.from(statementResults)
			.where(and(eq(statementResults.accountId, accountId), eq(statementResults.statementId, id)))
			.orderBy(asc(statementResults.createdAt), asc(statementResults.id));
		if (!propertyResult) return undefined;
		const frozenLeases = rows.map((entry) => JSON.parse(entry.result) as LeaseStatement);
		result = { property: propertyResult, leases: frozenLeases };
		const leaseIds = rows.map((entry) => entry.leaseId);
		const [reversals, leaseRows] = await Promise.all([
			deliveryReversals(db, accountId, id),
			chunked(leaseIds, (ids) =>
				db
					.select({ id: leases.id, endDate: leases.endDate })
					.from(leases)
					.where(and(eq(leases.accountId, accountId), inArray(leases.id, ids)))
			)
		]);
		const day = today();
		leaseResults = rows.map((entry, index) => {
			const lease = leaseRows.find((candidate) => candidate.id === entry.leaseId);
			return {
				leaseId: entry.leaseId,
				balance: entry.balance,
				deliveredOn: entry.deliveredOn,
				dueDate: claimDueDate(frozenLeases[index], entry.deliveredOn),
				objectionDeadline: entry.deliveredOn ? objectionDeadline(entry.deliveredOn) : null,
				reversedOnDelivery:
					0 - (reversals.find((charge) => charge.leaseId === entry.leaseId)?.amount ?? 0),
				active: Boolean(lease) && (lease!.endDate === null || lease!.endDate >= day)
			};
		});
	} else {
		result = await computeDraft(db, accountId, row);
		if (!result) return undefined;
	}

	const [correctedBy, corrects] = await Promise.all([
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

/** Creates a draft for the property and period with the computed result stored. */
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
	const overlapping = await db
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
		.orderBy(asc(operatingCostStatements.periodStart));
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
	const period = { start: input.periodStart, end: input.periodEnd };
	const statementInput = await loadStatementInput(db, accountId, input.propertyId, period);
	if (!statementInput) return { ok: false, message: 'Dieses Objekt gibt es nicht.' };
	const result = computeStatement(statementInput);
	await assertQuota(db, accountId, 'operatingCostStatements');

	const id = crypto.randomUUID();
	const label = periodLabel(period.start, period.end);
	await runBatch(db, [
		db.insert(operatingCostStatements).values({
			id,
			accountId,
			propertyId: input.propertyId,
			periodStart: period.start,
			periodEnd: period.end,
			version: 1,
			status: 'draft',
			result: JSON.stringify(result.property)
		}),
		auditEntry(
			db,
			context,
			'statement',
			id,
			'create',
			`${statementName(label, statementInput.property.name)} als Entwurf angelegt`
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
	const result = await computeDraft(db, accountId, row, { today: approvedOn });
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
		const previous = await chargesOfStatement(db, accountId, row.correctsId);
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

	// The balance credits the paid prepayments only; the unpaid ones are still charged on the rent
	// account. So the posting is the claim less the unpaid prepayments: together they make up the
	// claim, and nothing counts twice. § 556 Abs. 3 BGB: after the deadline a residential
	// Nachzahlung is excluded, but not as far as it rests on prepayments the tenant did not pay
	// (BGH VIII ZR 261/06): the posting may not exceed 0 then, for a correction not what the
	// corrected statement still posts. A posting to pay is due 30 days after the statement reached
	// the tenant, so it has no due date until the delivery is recorded; a credit is due 30 days
	// after the approval.
	const frozen: LeaseStatement[] = result.leases.map((lease) => {
		const excluded =
			lease.late && lease.leaseKind === 'residential' && !input.lateApprovalJustified;
		const due = lease.balance - lease.unpaidPrepayments;
		const posting = excluded ? Math.min(due, previousPostings.get(lease.leaseId) ?? 0) : due;
		const posted = posting + lease.unpaidPrepayments;
		return { ...lease, approvedOn, dueDate: posted > 0 ? null : creditDue, posted };
	});
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
	await assertQuota(db, accountId, 'statementResults', resultRows.length);
	await assertQuota(db, accountId, 'rentCharges', statements.length);

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
	const existing = await correctionOf(db, accountId, id);
	if (existing) {
		return {
			ok: false,
			message:
				existing.status === 'draft'
					? 'Zu dieser Abrechnung gibt es schon einen Korrekturentwurf.'
					: 'Diese Abrechnung wurde schon korrigiert; korrigiere die neueste Version.'
		};
	}
	const result = await computeDraft(db, accountId, row);
	if (!result) return { ok: false, message: 'Dieses Objekt gibt es nicht.' };
	const [latest] = await db
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
		.orderBy(desc(operatingCostStatements.version));
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
			correctsId: id,
			result: JSON.stringify(result.property)
		}),
		auditEntry(
			db,
			context,
			'statement',
			correctionId,
			'correct',
			`Korrektur (Version ${version}) der ${statementName(label, result.property.propertyName)} als Entwurf angelegt`
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
	const [property] = await db
		.select({ name: properties.name })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, row.propertyId)));
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
			`Entwurf der ${statementName(label, property?.name ?? '')} gelöscht`
		)
	]);
	return true;
}

// The letter

function lines(...parts: (string | null | undefined)[]): string[] {
	return parts.filter((part): part is string => Boolean(part && part.trim()));
}

function greeting(statement: LeaseStatement): string {
	const names = statement.tenants.map((tenant) => {
		const salutation = tenant.salutation === 'Frau' || tenant.salutation === 'Herr';
		return salutation ? `${tenant.salutation} ${tenant.lastName}` : personName(tenant);
	});
	return names.length > 0 ? `Guten Tag ${names.join(', ')},` : 'Guten Tag,';
}

/** The subject line of the letter, also the start of the file name. */
function statementSubject(statement: LeaseStatement): string {
	return `Betriebskostenabrechnung ${periodLabel(statement.period.start, statement.period.end)}`;
}

export function statementFilename(statement: LeaseStatement): string {
	const unitNames = statement.units.map((unit) => unit.name).join(' ');
	return `${statementSubject(statement)} ${unitNames}.pdf`;
}

/**
 * The letter for one lease, built from the frozen result alone: sender, recipient, the cost table
 * with Gesamtkosten, Umlageschlüssel and the tenant's share, the CO2 disclosure, the paid
 * prepayments and the balance with when it is due. PDFs write "CO2", the renderer has no
 * subscript glyph.
 */
export function statementLetter(statement: LeaseStatement): Letter {
	const { landlord, property } = statement;
	const unitNames = statement.units.map((unit) => unit.name).join(' + ');
	const periodText = `${formatDate(statement.period.start)} bis ${formatDate(statement.period.end)}`;
	const addressTenant = statement.tenants.find((tenant) => tenant.street || tenant.city);
	const recipient = lines(
		...statement.tenants.map((tenant) => lines(tenant.salutation, personName(tenant)).join(' ')),
		addressTenant?.street ?? property.street,
		addressTenant
			? lines(addressTenant.postalCode, addressTenant.city).join(' ')
			: `${property.postalCode} ${property.city}`
	);
	const date = `${landlord.city ?? property.city}, ${formatDate(statement.approvedOn ?? today())}`;

	const area = statement.units.reduce((sum, unit) => sum + (unit.floorArea ?? 0), 0);
	const persons = statement.persons
		.map((entry) =>
			statement.persons.length === 1
				? pluralize(entry.persons, 'Person', 'Personen')
				: `${pluralize(entry.persons, 'Person', 'Personen')} vom ${formatDate(entry.from)} bis ${formatDate(entry.to)}`
		)
		.join(', ');
	const intro = [
		greeting(statement),
		`hiermit rechnen wir die Betriebskosten für ${unitNames} im Objekt ${property.name}, ${property.street}, ${property.postalCode} ${property.city} für den Zeitraum ${periodText} ab. ` +
			`Nutzungszeitraum: ${formatDate(statement.occupancy.start)} bis ${formatDate(statement.occupancy.end)} (${statement.occupancy.days} von ${statement.period.days} Tagen), ` +
			`Fläche ${formatArea(area)}, ${persons}.`
	];

	const costTable: PdfTable = {
		title: 'Kostenaufstellung',
		columns: [
			// Wide enough for the bold "Gesamtkosten" header, which the renderer would otherwise cut.
			{ label: 'Kostenart', width: 0.28 },
			{ label: 'Gesamtkosten', align: 'right', width: 0.18 },
			{ label: 'Umlageschlüssel', width: 0.36 },
			{ label: 'Ihr Anteil', align: 'right', width: 0.18 }
		],
		rows: statement.lines.map((line) => [
			lines(
				line.categoryName,
				line.betrkvItem ? `§ 2 Nr. ${line.betrkvItem} BetrKV` : null,
				line.description !== line.categoryName ? line.description : null
			).join('\n'),
			lines(
				line.association ? `${formatCents(line.association.total)} WEG` : null,
				line.association ? `Anteil ${formatCents(line.itemTotal)}` : formatCents(line.itemTotal),
				line.allocated !== line.itemTotal
					? `abzüglich CO2-Anteil Vermieter ${formatCents(line.itemTotal - line.allocated)}\numgelegt ${formatCents(line.allocated)}`
					: null
			).join('\n'),
			`${line.keyName}: ${line.keyTotal}\n${line.share}`,
			formatCents(line.amount)
		]),
		footer: ['Summe', '', '', formatCents(statement.costsTotal)]
	};

	const co2 = statement.lines
		.filter((line) => line.co2)
		.map((line) => {
			const data = line.co2!;
			return (
				`CO2-Kostenaufteilung (CO2KostAufG) für ${line.description}: ${formatNumber(data.co2Kg)} kg CO2 laut Beleg; ` +
				`das Gebäude stößt ${formatNumber(data.buildingCo2Kg)} kg CO2 im Jahr aus, bei ${formatArea(data.area)} Gebäudefläche ` +
				`${formatNumber(data.kgPerSquareMetre)} kg CO2 je m² und Jahr. Vermieteranteil ${data.landlordPercent} %: ` +
				`vom CO2-Preis ${formatCents(data.co2Cost)} trägt der Vermieter ${formatCents(data.landlordAmount)}; dieser Betrag ist von den Gesamtkosten abgezogen.`
			);
		});

	const chargedTotal = statement.prepayments.reduce((sum, month) => sum + month.charged, 0);
	const prepaymentTable: PdfTable = {
		title: 'Geleistete Vorauszahlungen',
		columns: [
			{ label: 'Monat', width: 0.24 },
			{ label: 'Soll', align: 'right', width: 0.19 },
			{ label: 'Betriebskosten', align: 'right', width: 0.19 },
			{ label: 'Heizkosten', align: 'right', width: 0.19 },
			{ label: 'Geleistet', align: 'right', width: 0.19 }
		],
		rows: statement.prepayments.map((month) => [
			formatMonth(month.period),
			formatCents(month.charged),
			formatCents(month.operatingCostPrepayment),
			formatCents(month.heatingCostPrepayment),
			formatCents(month.amount)
		]),
		footer: ['Summe', formatCents(chargedTotal), '', '', formatCents(statement.prepaymentsTotal)]
	};
	const unpaid =
		statement.unpaidPrepayments > 0
			? `Von den Vorauszahlungen für den Abrechnungszeitraum (${formatCents(chargedTotal)}) haben Sie ${formatCents(statement.unpaidPrepayments)} nicht geleistet. Die Abrechnung rechnet nur die geleisteten an; die offenen Vorauszahlungen sind im Ergebnis enthalten und werden nicht zusätzlich verlangt.`
			: null;

	const label = balanceLabel(statement.balance);
	const amount = formatCents(Math.abs(statement.balance));
	const result = `Kosten gesamt ${formatCents(statement.costsTotal)}, geleistete Vorauszahlungen ${formatCents(statement.prepaymentsTotal)}: ${label === 'ausgeglichen' ? 'Kosten und Vorauszahlungen gleichen sich aus.' : `${label} ${amount}.`}`;
	const dueDate = statement.dueDate ? formatDate(statement.dueDate) : null;
	// After the deadline (§ 556 Abs. 3 BGB) the claim can be less than the balance: a Nachzahlung
	// that is not claimed beyond the unpaid prepayments, or a late correction held to what was
	// claimed in time.
	const claimed = statement.posted ?? statement.balance;
	const late = 'Die Abrechnung erreicht Sie nach Ablauf der Abrechnungsfrist (§ 556 Abs. 3 BGB)';
	const limited =
		claimed >= statement.balance
			? null
			: claimed === 0
				? `${late}; die Nachzahlung von ${amount} wird nicht verlangt.`
				: claimed === statement.unpaidPrepayments
					? `${late}; von der Nachzahlung verlangen wir nur die ${formatCents(claimed)} Vorauszahlungen, die Sie nicht geleistet haben.`
					: 'Nach Ablauf der Abrechnungsfrist (§ 556 Abs. 3 BGB) gilt das rechtzeitig abgerechnete Ergebnis.';
	const claimedAmount = formatCents(Math.abs(claimed));
	let settlement: string;
	if (claimed > 0) {
		const account = lines(
			landlord.iban ? `IBAN ${landlord.iban}` : null,
			landlord.bankName ? `bei der ${landlord.bankName}` : null
		).join(' ');
		settlement =
			`Bitte überweisen Sie die Nachzahlung von ${claimedAmount} innerhalb von ${DUE_DAYS} Tagen nach Zugang dieser Abrechnung` +
			(account ? ` auf das Konto ${account}.` : '.');
	} else if (claimed < 0) {
		settlement = `Das Guthaben von ${claimedAmount} erstatten wir Ihnen${dueDate ? ` bis zum ${dueDate}` : ''} oder verrechnen es mit der nächsten Miete.`;
	} else {
		settlement = limited ? '' : 'Es ist nichts zu zahlen und nichts zu erstatten.';
	}
	settlement = [limited, settlement].filter(Boolean).join(' ');

	const excluded =
		statement.excluded.length > 0
			? [
					`Nicht enthalten (${statement.excluded[0].reason}): ` +
						statement.excluded
							.map((line) => `${line.categoryName} ${formatCents(line.amount)}`)
							.join(', ') +
						'.'
				]
			: [];

	return {
		sender: lines(
			landlord.name,
			landlord.street,
			lines(landlord.postalCode, landlord.city).join(' ')
		),
		recipient,
		date,
		subject: `${statementSubject(statement)} – ${property.name}, ${unitNames}`,
		paragraphs: [],
		blocks: [
			...intro.map((paragraph) => ({ paragraph })),
			{ table: costTable },
			...co2.map((paragraph) => ({ paragraph })),
			{ table: prepaymentTable },
			...(unpaid ? [{ paragraph: unpaid }] : []),
			{ paragraph: result },
			{ paragraph: settlement },
			...excluded.map((paragraph) => ({ paragraph })),
			{
				paragraph:
					'Die Belege können Sie nach Absprache einsehen. Einwendungen gegen diese Abrechnung teilen Sie uns bitte innerhalb von zwölf Monaten nach Zugang mit (§ 556 Abs. 3 BGB).'
			}
		],
		closing: ['Mit freundlichen Grüßen', '', landlord.name]
	};
}
