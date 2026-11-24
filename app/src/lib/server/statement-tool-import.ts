import { type Table } from 'drizzle-orm';
import { firstOfMonth, monthOf, today as berlinToday, type IsoDate } from '../dates';
import { computeTool, toolInput, type ToolState } from '../domain/statement-tool';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { chunk, rowsPerStatement, runBatch } from './db/batch';
import {
	allocationKeys,
	costCategories,
	costItemUnitAmounts,
	costItems,
	meterReadings,
	meters,
	properties,
	tenants,
	units
} from './db/schema';
import { newLeaseStatements, type LeaseInput } from './leases';
import { ensureDefaults, listCategories, listKeys } from './operating-costs';
import { assertQuota } from './quotas';
import { createStatement } from './statements';

// Takes over a statement made with the free tool on mietkartei.de/nebenkostenabrechnung/erstellen/
// into the account: the house as a new property with its flats, the tenants and leases, the bills
// of the period with their keys and the consumption as meter readings, and a draft of the
// statement, which then computes what the tool showed. The tool's file is read with the tool's
// own parser and converted with its own toolInput, so both see the same numbers.

export type ToolImportResult =
	{ ok: true; propertyId: string; statementId: string } | { ok: false; message: string };

/**
 * Writes the tool's state into the account. The rent account of each lease starts this month:
 * the prepayments of the period count as paid, as in the tool, and nothing before is shown as owed.
 */
export async function importToolState(
	db: Database,
	context: AuditContext,
	state: ToolState,
	today: IsoDate = berlinToday()
): Promise<ToolImportResult> {
	const { accountId } = context;
	const result = computeTool(state, today);
	const problem = result.issues.find((issue) => issue.blocking);
	if (!result.statement || problem) {
		return {
			ok: false,
			message: `Die Abrechnung in der Datei ist noch nicht vollständig: ${problem?.message ?? 'Der Zeitraum ist ungültig.'}`
		};
	}
	// The tool's own conversion, so the draft computes from the same figures.
	const input = toolInput(state);
	await assertQuota(db, accountId, 'properties');
	await assertQuota(db, accountId, 'units', input.units.length);
	await assertQuota(db, accountId, 'tenants', input.leases.length);
	await assertQuota(db, accountId, 'leases', input.leases.length);
	await assertQuota(db, accountId, 'costItems', input.items.length);
	await assertQuota(db, accountId, 'meters', input.meters.length);

	await ensureDefaults(db, accountId);
	const [categoryRows, keyRows] = await Promise.all([
		listCategories(db, accountId),
		listKeys(db, accountId)
	]);

	const propertyId = crypto.randomUUID();
	const unitIds = new Map(input.units.map((unit) => [unit.id, crypto.randomUUID()]));
	const leaseIds = new Map(input.leases.map((lease) => [lease.id, crypto.randomUUID()]));

	// The account's category of each BetrKV item, or a new one when the landlord removed it.
	const newCategories: (typeof costCategories.$inferInsert)[] = [];
	const categoryId = (betrkvItem: number, name: string): string => {
		const existing =
			categoryRows.find((row) => row.betrkvItem === betrkvItem && row.allocable) ??
			newCategories.find((row) => row.betrkvItem === betrkvItem);
		if (existing) return existing.id!;
		const row = {
			id: crypto.randomUUID(),
			accountId,
			name,
			betrkvItem,
			allocable: true,
			consumptionBased: [4, 5, 6].includes(betrkvItem),
			sortOrder: betrkvItem
		};
		newCategories.push(row);
		return row.id;
	};
	// An account key of the same kind, or a new one for this property.
	const newKeys: (typeof allocationKeys.$inferInsert)[] = [];
	const keyId = (key: (typeof input.keys)[number]): string => {
		const same = (row: {
			kind: string;
			meterKind: string | null;
			consumptionPercent: number | null;
		}) =>
			row.kind === key.kind &&
			(row.meterKind ?? null) === key.meterKind &&
			(row.consumptionPercent ?? null) === key.consumptionPercent;
		const existing =
			keyRows.find((row) => row.propertyId === null && same(row)) ??
			newKeys.find((row) =>
				same({
					kind: row.kind,
					meterKind: row.meterKind ?? null,
					consumptionPercent: row.consumptionPercent ?? null
				})
			);
		if (existing) return existing.id!;
		const row = {
			id: crypto.randomUUID(),
			accountId,
			propertyId,
			name: key.name,
			kind: key.kind,
			meterKind: key.meterKind,
			consumptionPercent: key.consumptionPercent
		};
		newKeys.push(row);
		return row.id;
	};

	const thisMonth = firstOfMonth(monthOf(today));
	const tenantRows = input.leases.map((lease) => ({
		id: crypto.randomUUID(),
		accountId,
		...lease.tenants[0],
		// A tenant who moved out is archived, as the lease page does it.
		archivedAt: lease.endDate && lease.endDate < today ? lease.endDate : null
	}));
	const leaseEntries = input.leases.map((lease, index) => {
		const rent = lease.rentHistory[0];
		const leaseInput: LeaseInput = {
			unitId: unitIds.get(lease.unitIds[0])!,
			extraUnitIds: [],
			tenantIds: [tenantRows[index].id],
			startDate: lease.startDate,
			endDate: lease.endDate,
			kind: 'residential',
			rentModel: 'fixed',
			operatingCostModel: 'prepayment',
			heatingCostModel: 'prepayment',
			// The tool knows no Kaltmiete; the landlord adds it on the lease.
			baseRent: 0,
			parkingRent: 0,
			operatingCostPrepayment: rent.operatingCostPrepayment,
			heatingCostPrepayment: rent.heatingCostPrepayment,
			securityDeposit: 0,
			persons: lease.persons[0].persons,
			rentDueDay: 3,
			ledgerStart: lease.startDate > thisMonth ? lease.startDate : thisMonth,
			indexBaseMonth: null,
			indexBaseValue: null,
			indexBaseYear: '2020',
			terminatedAt: null,
			terminatedBy: null,
			notes: 'Aus dem kostenlosen Rechner auf mietkartei.de übernommen.'
		};
		return { id: leaseIds.get(lease.id)!, input: leaseInput };
	});

	const keyById = new Map(input.keys.map((key) => [key.id, key]));
	const categoryById = new Map(input.categories.map((category) => [category.id, category]));
	const itemRows = input.items.map((item) => {
		const category = categoryById.get(item.categoryId)!;
		return {
			id: crypto.randomUUID(),
			accountId,
			propertyId,
			categoryId: categoryId(category.betrkvItem!, category.name),
			allocationKeyId: keyId(keyById.get(item.allocationKeyId)!),
			description: item.description,
			periodStart: item.periodStart,
			periodEnd: item.periodEnd,
			amount: item.amount,
			allocable: true,
			fuel: item.fuel,
			fuelKwh: item.fuelKwh,
			co2Kg: item.co2Kg,
			co2Cost: item.co2Cost,
			unitAmounts: item.unitAmounts
		};
	});
	const unitAmountRows = itemRows.flatMap((item) =>
		item.unitAmounts.map((row) => ({
			accountId,
			costItemId: item.id,
			unitId: unitIds.get(row.unitId)!,
			leaseId: row.leaseId ? leaseIds.get(row.leaseId)! : null,
			amount: row.amount
		}))
	);
	const meterRows = input.meters.map((meter) => ({
		id: crypto.randomUUID(),
		accountId,
		propertyId,
		unitId: unitIds.get(meter.unitId!)!,
		kind: meter.kind,
		unit: meter.unit
	}));
	const readingRows = input.meters.flatMap((meter, index) =>
		meter.readings.map((reading) => ({
			id: crypto.randomUUID(),
			accountId,
			meterId: meterRows[index].id,
			readAt: reading.readAt,
			value: reading.value,
			note: 'Verbrauch aus dem kostenlosen Rechner'
		}))
	);

	const insert = <T extends Table>(table: T, rows: T['$inferInsert'][]) =>
		chunk(rows, rowsPerStatement(table)).map((group) => db.insert(table).values(group));
	await runBatch(db, [
		db.insert(properties).values({
			id: propertyId,
			accountId,
			name: input.property.name,
			street: input.property.street,
			postalCode: input.property.postalCode,
			city: input.property.city,
			kind: 'building'
		}),
		...insert(
			units,
			input.units.map((unit) => ({
				id: unitIds.get(unit.id)!,
				accountId,
				propertyId,
				name: unit.name,
				kind: 'apartment' as const,
				floorArea: unit.floorArea
			}))
		),
		...insert(costCategories, newCategories),
		...insert(allocationKeys, newKeys),
		...insert(tenants, tenantRows),
		...newLeaseStatements(db, context, leaseEntries),
		...insert(
			costItems,
			itemRows.map((row) => ({ ...row, unitAmounts: undefined }))
		),
		...insert(costItemUnitAmounts, unitAmountRows),
		...insert(meters, meterRows),
		...insert(meterReadings, readingRows),
		auditEntry(
			db,
			context,
			'property',
			propertyId,
			'create',
			`Objekt ${input.property.name} aus dem kostenlosen Rechner übernommen`
		)
	]);
	const statement = await createStatement(db, context, {
		propertyId,
		periodStart: input.period.start,
		periodEnd: input.period.end
	});
	if (!statement.ok) return { ok: false, message: statement.message };
	return { ok: true, propertyId, statementId: statement.id };
}
