import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
	addDays,
	addMonths,
	formatDate,
	formatMonth,
	monthOf,
	today,
	type DateRange,
	type IsoDate
} from '../dates';
import type { Meter, Reading } from '../domain/consumption';
import {
	OBJECTION_MONTHS,
	balanceLabel,
	computeStatement,
	leaseLabel,
	periodLabel,
	validatePeriod,
	type LeaseStatement,
	type PropertyResult,
	type StatementInput,
	type StatementLease,
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
	properties,
	rentCharges,
	rentChanges,
	statementResults,
	tenants,
	units
} from './db/schema';
import { chargeEntry, ensureCharges } from './ledger';
import type { Letter, PdfTable } from './pdf';

// The operating cost statements (Betriebskostenabrechnungen): loading everything the pure
// computation needs with a fixed number of queries, the draft → approved → corrected life cycle,
// and the letter printed from a frozen per-lease result. Drafts are recomputed on every view; an
// approved statement is never changed again, a correction is a new version.

type Statement = BatchItem<'sqlite'>;

/** Nachzahlungen are due this many days after the approval (assumption 7 of PROTOTYPE.md). */
export const DUE_DAYS = 30;

export type StatementRow = typeof operatingCostStatements.$inferSelect;

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
 * the account. Rent charges of the leases are synced first, so the prepayments are current.
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

	const [tenantRows, personRows, changeRows, chargeRows] = await Promise.all([
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
		chunked(leaseIds, (ids) =>
			db
				.select()
				.from(rentCharges)
				.where(
					and(
						eq(rentCharges.accountId, accountId),
						inArray(rentCharges.leaseId, ids),
						eq(rentCharges.kind, 'rent'),
						gte(rentCharges.period, monthOf(period.start)),
						lte(rentCharges.period, monthOf(period.end))
					)
				)
		)
	]);

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
			.filter((row) => row.leaseId === lease.id)
			.map((row) => ({
				period: row.period,
				operatingCostPrepayment: row.operatingCostPrepayment,
				heatingCostPrepayment: row.heatingCostPrepayment
			}))
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
			buildingUse: property.buildingUse,
			vacancyPersons: property.vacancyPersons
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
				.map((row) => ({ unitId: row.unitId, amount: row.amount }))
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
	/** § 556 Abs. 3 Satz 5 BGB: twelve months after the delivery. */
	objectionDeadline: IsoDate | null;
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

async function statementRow(db: Database, accountId: string, id: string) {
	const [row] = await db
		.select()
		.from(operatingCostStatements)
		.where(
			and(eq(operatingCostStatements.accountId, accountId), eq(operatingCostStatements.id, id))
		);
	return row;
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
	row: StatementRow
): Promise<StatementResult | undefined> {
	const input = await loadStatementInput(db, accountId, row.propertyId, {
		start: row.periodStart,
		end: row.periodEnd
	});
	return input && computeStatement(input);
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
		result = {
			property: propertyResult,
			leases: rows.map((entry) => JSON.parse(entry.result) as LeaseStatement)
		};
		leaseResults = rows.map((entry) => ({
			leaseId: entry.leaseId,
			balance: entry.balance,
			deliveredOn: entry.deliveredOn,
			objectionDeadline: entry.deliveredOn ? addMonths(entry.deliveredOn, OBJECTION_MONTHS) : null
		}));
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
	const [existing] = await db
		.select({ id: operatingCostStatements.id, status: operatingCostStatements.status })
		.from(operatingCostStatements)
		.where(
			and(
				eq(operatingCostStatements.accountId, accountId),
				eq(operatingCostStatements.propertyId, input.propertyId),
				eq(operatingCostStatements.periodStart, input.periodStart),
				eq(operatingCostStatements.periodEnd, input.periodEnd)
			)
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
	const period = { start: input.periodStart, end: input.periodEnd };
	const statementInput = await loadStatementInput(db, accountId, input.propertyId, period);
	if (!statementInput) return { ok: false, message: 'Dieses Objekt gibt es nicht.' };
	const result = computeStatement(statementInput);

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
			result: JSON.stringify(result.property),
			resultVersion: result.property.resultVersion
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
 * Approves a draft: freezes the results, posts one `statement_balance` charge per lease (the
 * Nachzahlung of a residential lease after the deadline only with `lateApprovalJustified`,
 * otherwise 0) and, for a correction, the reversal of the corrected statement's charges, all in
 * one batch with the audit entry.
 */
export async function approveStatement(
	db: Database,
	context: AuditContext,
	id: string,
	input: ApprovalInput
): Promise<StatementOutcome> {
	const { accountId } = context;
	const row = await statementRow(db, accountId, id);
	if (!row) return { ok: false, message: 'Diese Abrechnung gibt es nicht.' };
	if (row.status === 'approved') {
		return { ok: false, message: 'Diese Abrechnung ist schon freigegeben.' };
	}
	const result = await computeDraft(db, accountId, row);
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

	const approvedOn = today();
	const dueDate = addDays(approvedOn, DUE_DAYS);
	const period = monthOf(row.periodEnd);
	const label = periodLabel(row.periodStart, row.periodEnd);
	const name = statementName(label, result.property.propertyName);
	const statements: Statement[] = [];

	// A correction takes the corrected statement's charges back first.
	if (row.correctsId) {
		const previous = await db
			.select()
			.from(rentCharges)
			.where(
				and(
					eq(rentCharges.accountId, accountId),
					eq(rentCharges.referenceId, row.correctsId),
					isNull(rentCharges.reversesChargeId)
				)
			);
		for (const charge of previous) {
			statements.push(
				chargeEntry(db, context, {
					leaseId: charge.leaseId,
					kind: 'statement_balance',
					period,
					dueDate,
					amount: -charge.amount,
					referenceId: id,
					reversesChargeId: charge.id,
					note: `Storno durch Korrektur der Betriebskostenabrechnung ${label}`
				}).statement
			);
		}
	}

	const frozen: LeaseStatement[] = result.leases.map((lease) => {
		const withheld =
			lease.late &&
			lease.leaseKind === 'residential' &&
			lease.balance > 0 &&
			!input.lateApprovalJustified;
		return { ...lease, approvedOn, dueDate, posted: withheld ? 0 : lease.balance };
	});
	const propertyResult: PropertyResult = { ...result.property, approvedOn, dueDate };

	const resultRows = frozen.map((lease) => ({
		id: crypto.randomUUID(),
		accountId,
		statementId: id,
		leaseId: lease.leaseId,
		balance: lease.balance,
		result: JSON.stringify(lease)
	}));
	for (const lease of frozen) {
		statements.push(
			chargeEntry(db, context, {
				leaseId: lease.leaseId,
				kind: 'statement_balance',
				period,
				dueDate,
				amount: lease.posted ?? lease.balance,
				referenceId: id,
				note:
					lease.posted === 0 && lease.balance > 0
						? `Nachzahlung ${formatCents(lease.balance)} nach Ablauf der Abrechnungsfrist nicht verlangt (§ 556 Abs. 3 BGB)`
						: `Betriebskostenabrechnung ${label}`
			}).statement
		);
	}

	await runBatch(db, [
		db
			.update(operatingCostStatements)
			.set({
				status: 'approved',
				result: JSON.stringify(propertyResult),
				resultVersion: propertyResult.resultVersion,
				lateApprovalJustified: input.lateApprovalJustified,
				note: input.note,
				approvedAt: new Date(),
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
			result: JSON.stringify(result.property),
			resultVersion: result.property.resultVersion
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

/** Records when the statement reached the tenant; starts the Einwendungsfrist. */
export async function setDelivered(
	db: Database,
	context: AuditContext,
	statementId: string,
	leaseId: string,
	date: IsoDate
): Promise<boolean> {
	const { accountId } = context;
	const [row] = await db
		.select({
			id: statementResults.id,
			result: statementResults.result,
			periodStart: operatingCostStatements.periodStart,
			periodEnd: operatingCostStatements.periodEnd
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
	if (!row) return false;
	const lease = JSON.parse(row.result) as LeaseStatement;
	const label = periodLabel(row.periodStart, row.periodEnd);
	await runBatch(db, [
		db
			.update(statementResults)
			.set({ deliveredOn: date })
			.where(and(eq(statementResults.accountId, accountId), eq(statementResults.id, row.id))),
		auditEntry(
			db,
			context,
			'statement',
			statementId,
			'update',
			`Betriebskostenabrechnung ${label} für ${leaseLabel(lease.units, lease.tenants)} am ${formatDate(date)} zugestellt`
		)
	]);
	return true;
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
export function statementSubject(statement: LeaseStatement): string {
	return `Betriebskostenabrechnung ${periodLabel(statement.period.start, statement.period.end)}`;
}

export function statementFilename(statement: LeaseStatement): string {
	const unitNames = statement.units.map((unit) => unit.name).join(' ');
	return `${statementSubject(statement)} ${unitNames}.pdf`;
}

/**
 * The letter for one lease, built from the frozen result alone: sender, recipient, the cost table
 * with Gesamtkosten, Umlageschlüssel and the tenant's share, the CO2 disclosure, the prepayments
 * and the balance with its due date. PDFs write "CO2", the renderer has no subscript glyph.
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
			{ label: 'Dein Anteil', align: 'right', width: 0.18 }
		],
		rows: statement.lines.map((line) => [
			lines(
				line.categoryName,
				line.betrkvItem ? `§ 2 Nr. ${line.betrkvItem} BetrKV` : null,
				line.description !== line.categoryName ? line.description : null
			).join('\n'),
			line.allocated !== line.itemTotal
				? `${formatCents(line.itemTotal)}\nabzüglich CO2-Anteil Vermieter: ${formatCents(line.allocated)}`
				: formatCents(line.itemTotal),
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
				`CO2-Kostenaufteilung (CO2KostAufG) für ${line.description}: ${formatNumber(data.co2Kg)} kg CO2 bei ${formatArea(data.area)} Gebäudefläche, ` +
				`${formatNumber(data.kgPerSquareMetre)} kg CO2 je m² und Jahr. Vermieteranteil ${data.landlordPercent} %: ` +
				`vom CO2-Preis ${formatCents(data.co2Cost)} trägt der Vermieter ${formatCents(data.landlordAmount)}; dieser Betrag ist von den Gesamtkosten abgezogen.`
			);
		});

	const prepaymentTable: PdfTable = {
		title: 'Vorauszahlungen',
		columns: [
			{ label: 'Monat', width: 0.3 },
			{ label: 'Betriebskosten', align: 'right', width: 0.2 },
			{ label: 'Heizkosten', align: 'right', width: 0.2 },
			{ label: 'Vorauszahlung', align: 'right', width: 0.3 }
		],
		rows: statement.prepayments.map((month) => [
			formatMonth(month.period),
			formatCents(month.operatingCostPrepayment),
			formatCents(month.heatingCostPrepayment),
			formatCents(month.amount)
		]),
		footer: ['Vorauszahlungen gesamt', '', '', formatCents(statement.prepaymentsTotal)]
	};

	const label = balanceLabel(statement.balance);
	const amount = formatCents(Math.abs(statement.balance));
	const result = `Kosten gesamt ${formatCents(statement.costsTotal)}, Vorauszahlungen ${formatCents(statement.prepaymentsTotal)}: ${label === 'ausgeglichen' ? 'Kosten und Vorauszahlungen gleichen sich aus.' : `${label} ${amount}.`}`;
	const dueDate = statement.dueDate ? formatDate(statement.dueDate) : null;
	let settlement: string;
	if (statement.balance > 0 && statement.posted === 0) {
		settlement = `Die Abrechnung erreicht dich nach Ablauf der Abrechnungsfrist (§ 556 Abs. 3 BGB); die Nachzahlung von ${amount} wird nicht verlangt.`;
	} else if (statement.balance > 0) {
		const account = lines(
			landlord.iban ? `IBAN ${landlord.iban}` : null,
			landlord.bankName ? `bei der ${landlord.bankName}` : null
		).join(' ');
		settlement =
			`Bitte überweise die Nachzahlung von ${amount}${dueDate ? ` bis zum ${dueDate}` : ''}` +
			(account ? ` auf das Konto ${account}.` : '.');
	} else if (statement.balance < 0) {
		settlement = `Das Guthaben von ${amount} erstatten wir dir${dueDate ? ` bis zum ${dueDate}` : ''} oder verrechnen es mit der nächsten Miete.`;
	} else {
		settlement = 'Es ist nichts zu zahlen und nichts zu erstatten.';
	}

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
			{ paragraph: result },
			{ paragraph: settlement },
			...excluded.map((paragraph) => ({ paragraph })),
			{
				paragraph:
					'Die Belege kannst du nach Absprache einsehen. Einwendungen gegen diese Abrechnung teile uns bitte innerhalb von zwölf Monaten nach Zugang mit (§ 556 Abs. 3 BGB).'
			}
		],
		closing: ['Mit freundlichen Grüßen', '', landlord.name]
	};
}
