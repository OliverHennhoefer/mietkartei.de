import { sql, type Table } from 'drizzle-orm';
import { monthOf, monthsInRange, today, type IsoDate } from '../dates';
import { defaultMeterUnit } from '../domain/operating-costs';
import {
	referenceCases,
	referenceKey,
	type ReferenceCase,
	type ReferenceCategory
} from '../domain/reference-cases';
import { monthlyAmounts } from '../domain/rents';
import type { AuditContext } from './audit';
import type { Database } from './db';
import { chunk, rowsPerStatement, runBatch } from './db/batch';
import {
	allocationKeys,
	auditLog,
	costItems,
	meterReadings,
	meters,
	payments,
	properties,
	tenants,
	units
} from './db/schema';
import { isEmptyAccount } from './demo';
import { newLeaseStatements, type LeaseInput } from './leases';
import { ensureDefaults, listCategories, listKeys } from './operating-costs';
import { createStatement } from './statements';

// A demo account holding one of the Rechenbeispiele of mietkartei.de/rechenbeispiele/: its house,
// leases, Belege and meters as the case states them, every prepayment paid on time, and the draft
// of its statement. The draft computes from these rows what the page shows from the case itself.

/** The case of the slug, or undefined for any other text. */
export function referenceCase(slug: string | null): ReferenceCase | undefined {
	return referenceCases.find((c) => c.slug === slug);
}

/** The categories of the account the case's categories stand for. */
const categoryNames: Record<ReferenceCategory, string> = {
	grundsteuer: 'Grundsteuer',
	wasser: 'Wasserversorgung',
	abwasser: 'Entwässerung',
	muell: 'Straßenreinigung und Müllbeseitigung',
	hausmeister: 'Hauswart',
	versicherung: 'Sach- und Haftpflichtversicherung',
	heizung: 'Heizung'
};

/**
 * Writes the case into the empty account and returns the id of its statement draft, or null when
 * the account holds data already.
 */
export async function createReferenceData(
	db: Database,
	context: AuditContext,
	c: ReferenceCase
): Promise<string | null> {
	const { accountId } = context;
	if (!(await isEmptyAccount(db, accountId))) return null;
	const date = today();
	const period = { start: `${c.year}-01-01`, end: `${c.year}-12-31` };

	await ensureDefaults(db, accountId);
	const categories = await listCategories(db, accountId);
	const keys = await listKeys(db, accountId);
	const categoryId = (name: string) => categories.find((row) => row.name === name)!.id;
	// A key the account does not start with, the Kaltwasser key, is added for the case.
	const keyRows = [...new Map(c.items.map((item) => [referenceKey(item).name, item])).values()]
		.filter((item) => !keys.some((row) => row.name === referenceKey(item).name))
		.map((item) => ({
			id: crypto.randomUUID(),
			accountId,
			name: referenceKey(item).name,
			kind: item.key,
			meterKind: referenceKey(item).meterKind,
			consumptionPercent: item.consumptionPercent ?? null
		}));
	const keyId = (name: string) => [...keys, ...keyRows].find((row) => row.name === name)!.id;

	const propertyId = crypto.randomUUID();
	const unitIds = new Map(c.units.map((unit) => [unit.id, crypto.randomUUID()]));
	const unitRows = c.units.map((unit) => ({
		id: unitIds.get(unit.id)!,
		accountId,
		propertyId,
		name: unit.name,
		kind: 'apartment' as const,
		floorArea: unit.area
	}));
	const tenantRows = c.leases.map((lease) => ({
		id: crypto.randomUUID(),
		accountId,
		...lease.tenant,
		// A tenant who moved out is archived, as the lease page does it.
		archivedAt: lease.end && lease.end < date ? lease.end : null
	}));
	const leaseEntries = c.leases.map((lease, index) => {
		// The rent account starts with the year of the statement, so the years before it are not
		// open in the Mietkonto.
		const ledgerStart = lease.start > period.start ? lease.start : period.start;
		const input: LeaseInput = {
			unitId: unitIds.get(lease.unitId)!,
			extraUnitIds: [],
			tenantIds: [tenantRows[index].id],
			startDate: lease.start,
			endDate: lease.end,
			kind: 'residential',
			rentModel: 'fixed',
			operatingCostModel: 'prepayment',
			heatingCostModel: 'prepayment',
			baseRent: lease.baseRent,
			operatingCostPrepayment: lease.operatingCostPrepayment,
			heatingCostPrepayment: lease.heatingCostPrepayment,
			securityDeposit: 0,
			persons: lease.persons,
			rentDueDay: 3,
			ledgerStart,
			indexBaseMonth: null,
			indexBaseValue: null,
			indexBaseYear: '2020',
			terminatedAt: null,
			terminatedBy: null,
			notes: null
		};
		return { id: crypto.randomUUID(), input, lease };
	});
	// Every month's rent paid on its due day, or on the first day of the lease, up to this month.
	const paymentRows = leaseEntries.flatMap(({ id, input, lease }) => {
		const last = lease.end && lease.end < date ? lease.end : date;
		const history = [
			{
				validFrom: lease.start,
				baseRent: lease.baseRent,
				operatingCostPrepayment: lease.operatingCostPrepayment,
				heatingCostPrepayment: lease.heatingCostPrepayment,
				status: 'approved' as const
			}
		];
		return monthsInRange(monthOf(input.ledgerStart!), monthOf(last)).flatMap((month) => {
			const amounts = monthlyAmounts(
				history,
				{ startDate: lease.start, endDate: lease.end },
				month
			);
			const due: IsoDate = `${month}-03`;
			const day = due < lease.start ? lease.start : due;
			if (day > date) return [];
			return [
				{
					id: crypto.randomUUID(),
					accountId,
					leaseId: id,
					date: day,
					amount:
						amounts.baseRent + amounts.operatingCostPrepayment + amounts.heatingCostPrepayment,
					source: 'manual' as const,
					note: `Miete ${month}`
				}
			];
		});
	});
	const costItemRows = c.items.map((item) => ({
		id: crypto.randomUUID(),
		accountId,
		propertyId,
		categoryId: categoryId(categoryNames[item.category]),
		allocationKeyId: keyId(referenceKey(item).name),
		description: item.description,
		periodStart: item.periodStart,
		periodEnd: item.periodEnd,
		amount: item.amount,
		allocable: true,
		fuel: item.co2?.fuel ?? null,
		fuelKwh: item.co2?.fuelKwh ?? null,
		co2Kg: item.co2?.co2Kg ?? null,
		co2Cost: item.co2?.co2Cost ?? null
	}));
	const meterRows = (c.meters ?? []).map((meter) => ({
		id: crypto.randomUUID(),
		accountId,
		propertyId,
		unitId: unitIds.get(meter.unitId)!,
		kind: meter.kind,
		unit: defaultMeterUnit(meter.kind)
	}));
	const readingRows = (c.meters ?? []).flatMap((meter, index) =>
		[
			[period.start, meter.start],
			[period.end, meter.end]
		].map(([readAt, value]) => ({
			id: crypto.randomUUID(),
			accountId,
			meterId: meterRows[index].id,
			readAt: readAt as IsoDate,
			value: value as number
		}))
	);

	const insert = <T extends Table>(table: T, rows: T['$inferInsert'][]) =>
		chunk(rows, rowsPerStatement(table)).map((group) => db.insert(table).values(group));
	await runBatch(db, [
		db.insert(properties).values({
			id: propertyId,
			accountId,
			...c.property,
			kind: 'building',
			notes: `Rechenbeispiel „${c.title}“ von mietkartei.de/rechenbeispiele/${c.slug}/`
		}),
		...insert(units, unitRows),
		...insert(allocationKeys, keyRows),
		...insert(tenants, tenantRows),
		...newLeaseStatements(db, context, leaseEntries),
		...insert(payments, paymentRows),
		...insert(costItems, costItemRows),
		...insert(meters, meterRows),
		...insert(meterReadings, readingRows),
		db.insert(auditLog).values({
			accountId,
			userId: context.userId,
			entity: 'account',
			entityId: accountId,
			action: 'create',
			// As in createDemoData: a second run at the same time finds two properties and is rolled back.
			summary: sql`(select case when count(*) = 1 then ${'Rechenbeispiel angelegt'} end from ${properties} where ${properties.accountId} = ${accountId})`
		})
	]);
	const statement = await createStatement(db, context, {
		propertyId,
		periodStart: period.start,
		periodEnd: period.end
	});
	if (!statement.ok) throw new Error(statement.message);
	return statement.id;
}
