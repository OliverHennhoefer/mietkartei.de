import { isHttpError } from '@sveltejs/kit';
import { and, asc, eq, lte, sum } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, formatDate, today } from '../dates';
import { formatArea } from '../format';
import { computeStatement, type LeaseStatement } from '../domain/statement';
import type { Database } from './db';
import {
	allocationKeyShares,
	allocationKeys,
	auditLog,
	billingCircleUnits,
	billingCircles,
	costCategories,
	costItemUnitAmounts,
	costItems,
	meterReadings,
	meters,
	operatingCostStatements,
	payments,
	properties,
	rentCharges,
	statementResults,
	tenants,
	units
} from './db/schema';
import { createLease } from './leases';
import { ensureCharges } from './ledger';
import { QUOTAS } from './quotas';
import {
	approveStatement,
	createCorrection,
	createStatement,
	deleteDraft,
	getLeaseResult,
	getStatement,
	listPropertiesForStatements,
	listStatements,
	loadStatementInput,
	setDelivered,
	statementFilename,
	statementLetter
} from './statements';
import { contextA, contextB, leaseInput, seedUnit, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

afterEach(() => {
	vi.useRealTimers();
});

/** Lets `today()` (Berlin) return the given day; the database keeps working on real time. */
function travelTo(day: string) {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(`${day}T10:00:00Z`));
}

const period = { start: '2025-01-01', end: '2025-12-31' };

/**
 * Pays the rent account of each lease up to December 2025 in full, with one payment on
 * 31.12.2025: the statement credits the paid prepayments only.
 */
async function payRent(db: Database, accountId: string, leaseIds: string[]) {
	await ensureCharges(db, accountId, leaseIds, '2025-12');
	for (const leaseId of leaseIds) {
		const [{ total }] = await db
			.select({ total: sum(rentCharges.amount) })
			.from(rentCharges)
			.where(and(eq(rentCharges.leaseId, leaseId), lte(rentCharges.period, '2025-12')));
		await db
			.insert(payments)
			.values({ accountId, leaseId, date: '2025-12-31', amount: Number(total) });
	}
}

/**
 * The reference scenario of domain/statement.spec.ts as rows (see there for the hand
 * calculation): Lindenstraße 4 with EG, OG (tenant change on 30 June) and DG (vacant from
 * 1 September), the five cost items and the heat meters; every rent paid.
 */
async function seedScenario(db: Database, accountId: string) {
	const [property] = await db
		.insert(properties)
		.values({
			accountId,
			name: 'Lindenstraße 4',
			street: 'Lindenstraße 4',
			postalCode: '10115',
			city: 'Berlin',
			vacancyPersons: 1
		})
		.returning({ id: properties.id });
	const unitRows = await db
		.insert(units)
		.values([
			{ accountId, propertyId: property.id, name: 'EG', kind: 'apartment', floorArea: 72.5 },
			{ accountId, propertyId: property.id, name: 'OG', kind: 'apartment', floorArea: 64 },
			{ accountId, propertyId: property.id, name: 'DG', kind: 'apartment', floorArea: 48 }
		])
		.returning({ id: units.id, name: units.name });
	const unit = Object.fromEntries(unitRows.map((row) => [row.name, row.id]));
	const tenantRows = await db
		.insert(tenants)
		.values([
			{ accountId, salutation: 'Herr', firstName: 'Max', lastName: 'Müller' },
			{ accountId, salutation: 'Frau', firstName: 'Anna', lastName: 'Alt' },
			{ accountId, salutation: 'Herr', firstName: 'Bernd', lastName: 'Neu' },
			{ accountId, salutation: 'Frau', firstName: 'Dora', lastName: 'Dach' }
		])
		.returning({ id: tenants.id, lastName: tenants.lastName });
	const tenant = Object.fromEntries(tenantRows.map((row) => [row.lastName, row.id]));
	const context = { accountId, userId: `user-${accountId}` };
	const lease = async (input: ReturnType<typeof leaseInput>) => {
		const result = await createLease(db, context, input);
		if (!result.ok) throw new Error(result.reason);
		return result.id;
	};
	const leaseIds = {
		eg: await lease(
			leaseInput(unit.EG, {
				tenantIds: [tenant.Müller],
				startDate: '2024-06-01',
				ledgerStart: '2025-02-01',
				persons: 2
			})
		),
		ogA: await lease(
			leaseInput(unit.OG, {
				tenantIds: [tenant.Alt],
				startDate: '2023-01-01',
				endDate: '2025-06-30',
				operatingCostPrepayment: 12000,
				heatingCostPrepayment: 6000,
				persons: 2
			})
		),
		ogB: await lease(
			leaseInput(unit.OG, {
				tenantIds: [tenant.Neu],
				startDate: '2025-07-01',
				operatingCostPrepayment: 10000,
				heatingCostPrepayment: 5000,
				persons: 1
			})
		),
		dg: await lease(
			leaseInput(unit.DG, {
				tenantIds: [tenant.Dach],
				startDate: '2022-01-01',
				endDate: '2025-08-31',
				operatingCostPrepayment: 8000,
				heatingCostPrepayment: 4000,
				persons: 1
			})
		)
	};

	const categoryRows = await db
		.insert(costCategories)
		.values([
			{ accountId, name: 'Grundsteuer', betrkvItem: 1 },
			{ accountId, name: 'Müllbeseitigung', betrkvItem: 8 },
			{ accountId, name: 'Hauswart', betrkvItem: 14 },
			{ accountId, name: 'Heizung', betrkvItem: 4, consumptionBased: true },
			{ accountId, name: 'Verwaltungskosten (nicht umlagefähig)', allocable: false }
		])
		.returning({ id: costCategories.id, name: costCategories.name });
	const category = Object.fromEntries(categoryRows.map((row) => [row.name, row.id]));
	const keyRows = await db
		.insert(allocationKeys)
		.values([
			{ accountId, name: 'Wohnfläche', kind: 'area' },
			{ accountId, name: 'Personen', kind: 'persons' },
			{ accountId, name: 'Einheiten', kind: 'units' },
			{ accountId, name: 'Heizung 70/30', kind: 'mixed', meterKind: 'heat', consumptionPercent: 70 }
		])
		.returning({ id: allocationKeys.id, name: allocationKeys.name });
	const key = Object.fromEntries(keyRows.map((row) => [row.name, row.id]));
	const item = (
		description: string,
		categoryId: string,
		allocationKeyId: string,
		amount: number,
		extra: Partial<typeof costItems.$inferInsert> = {}
	) => ({
		accountId,
		propertyId: property.id,
		categoryId,
		allocationKeyId,
		description,
		periodStart: '2025-01-01',
		periodEnd: '2025-12-31',
		amount,
		...extra
	});
	await db.insert(costItems).values([
		item('Grundsteuer 2025', category.Grundsteuer, key.Wohnfläche, 120000),
		item('Müllabfuhr', category.Müllbeseitigung, key.Personen, 60000),
		item('Hausmeister', category.Hauswart, key.Einheiten, 90000),
		item('Gasrechnung', category.Heizung, key['Heizung 70/30'], 300000, {
			fuel: 'gas',
			fuelKwh: 25000,
			co2Kg: 5025,
			co2Cost: 30000
		}),
		item('Hausverwaltung', category['Verwaltungskosten (nicht umlagefähig)'], key.Einheiten, 50000)
	]);
	const meterRows = await db
		.insert(meters)
		.values([
			{ accountId, propertyId: property.id, unitId: unit.EG, kind: 'heat', unit: 'kWh' },
			{ accountId, propertyId: property.id, unitId: unit.OG, kind: 'heat', unit: 'kWh' },
			{ accountId, propertyId: property.id, unitId: unit.DG, kind: 'heat', unit: 'kWh' }
		])
		.returning({ id: meters.id, unitId: meters.unitId });
	const meter = Object.fromEntries(meterRows.map((row) => [row.unitId!, row.id]));
	await db.insert(meterReadings).values([
		{ accountId, meterId: meter[unit.EG], readAt: '2025-01-01', value: 0 },
		{ accountId, meterId: meter[unit.EG], readAt: '2025-12-31', value: 1000 },
		{ accountId, meterId: meter[unit.OG], readAt: '2025-01-01', value: 0 },
		{ accountId, meterId: meter[unit.OG], readAt: '2025-06-30', value: 600 },
		{ accountId, meterId: meter[unit.OG], readAt: '2025-12-31', value: 1000 },
		{ accountId, meterId: meter[unit.DG], readAt: '2025-01-01', value: 0 },
		{ accountId, meterId: meter[unit.DG], readAt: '2025-12-31', value: 200 }
	]);
	await payRent(db, accountId, Object.values(leaseIds));
	return { propertyId: property.id, unit, leaseIds, meter, key, category };
}

async function chargesOf(db: Database, leaseId: string) {
	return db
		.select()
		.from(rentCharges)
		.where(and(eq(rentCharges.leaseId, leaseId), eq(rentCharges.kind, 'statement_balance')))
		.orderBy(asc(rentCharges.createdAt), asc(rentCharges.id));
}

/**
 * The statement_balance postings of a lease, statement by statement in the given order: for each
 * one first its reversals, then its own posting (rows of one batch share their timestamp).
 */
async function postings(db: Database, leaseId: string, statementIds: string[]) {
	const rows = await chargesOf(db, leaseId);
	return statementIds.flatMap((statementId) => {
		const own = rows.filter((row) => row.referenceId === statementId);
		return [
			...own.filter((row) => row.reversesChargeId !== null),
			...own.filter((row) => row.reversesChargeId === null)
		].map((row) => row.amount);
	});
}

async function draft(db: Database, propertyId: string) {
	const created = await createStatement(db, contextA, {
		propertyId,
		periodStart: period.start,
		periodEnd: period.end
	});
	if (!created.ok) throw new Error(created.message);
	return created.id;
}

describe('loadStatementInput', () => {
	it('loads the scenario and reproduces the hand-computed balances', async () => {
		const { propertyId, leaseIds } = await seedScenario(db, 'a');
		await seedScenario(db, 'b');
		const input = (await loadStatementInput(db, 'a', propertyId, period))!;
		expect(input.property.name).toBe('Lindenstraße 4');
		expect(input.units).toHaveLength(3);
		expect(input.leases.map((lease) => lease.id).sort()).toEqual(Object.values(leaseIds).sort());
		expect(input.items).toHaveLength(5);
		expect(input.meters).toHaveLength(3);
		// The ledger was synced: EG has rent charges from the ledger start (February) to December.
		const eg = input.leases.find((lease) => lease.id === leaseIds.eg)!;
		expect(eg.charges.map((charge) => charge.period)).toEqual([
			'2025-02',
			'2025-03',
			'2025-04',
			'2025-05',
			'2025-06',
			'2025-07',
			'2025-08',
			'2025-09',
			'2025-10',
			'2025-11',
			'2025-12'
		]);
		expect(eg.tenants).toEqual([
			{
				salutation: 'Herr',
				firstName: 'Max',
				lastName: 'Müller',
				street: null,
				postalCode: null,
				city: null
			}
		]);

		const result = computeStatement(input, { today: '2026-03-15' });
		const balances = Object.fromEntries(
			result.leases.map((lease) => [lease.leaseId, lease.balance])
		);
		// The same numbers as domain/statement.spec.ts: EG −105,67, OG A +105,99, OG B +45,97, DG −202,13.
		expect(balances).toEqual({
			[leaseIds.eg]: -10567,
			[leaseIds.ogA]: 10599,
			[leaseIds.ogB]: 4597,
			[leaseIds.dg]: -20213
		});
		expect(result.leases.every((lease) => lease.unpaidPrepayments === 0)).toBe(true);
		expect(result.property.vacancyShare).toBe(39584);
		expect(result.property.landlordCo2Share).toBe(12000);
	});

	it('is undefined for a property of another account', async () => {
		const { propertyId } = await seedScenario(db, 'b');
		expect(await loadStatementInput(db, 'a', propertyId, period)).toBeUndefined();
	});

	it('loads extra units of leases elsewhere, billing circles, direct amounts and custom shares', async () => {
		const { propertyId, unit, category } = await seedScenario(db, 'a');
		const [garage] = await db
			.insert(units)
			.values({ accountId: 'a', propertyId, name: 'Garage', kind: 'parking', floorArea: null })
			.returning({ id: units.id });
		// A tenant of another house rents the garage as an extra unit of their lease.
		const other = await seedUnit(db, 'a', { propertyName: 'Nachbarhaus' });
		const created = await createLease(
			db,
			contextA,
			leaseInput(other.unitId, { extraUnitIds: [garage.id], startDate: '2025-03-01' })
		);
		if (!created.ok) throw new Error(created.reason);

		const [circle] = await db
			.insert(billingCircles)
			.values({ accountId: 'a', propertyId, name: 'Aufzug' })
			.returning({ id: billingCircles.id });
		await db.insert(billingCircleUnits).values([
			{ accountId: 'a', circleId: circle.id, unitId: unit.OG },
			{ accountId: 'a', circleId: circle.id, unitId: unit.DG }
		]);
		const [ownKey, direct, foreignKey] = await db
			.insert(allocationKeys)
			.values([
				{ accountId: 'a', propertyId, name: 'MEA', kind: 'custom' },
				{ accountId: 'a', name: 'Messdienst', kind: 'direct' },
				{ accountId: 'a', propertyId: other.propertyId, name: 'MEA Nachbarhaus', kind: 'custom' }
			])
			.returning({ id: allocationKeys.id });
		await db.insert(allocationKeyShares).values([
			{ accountId: 'a', keyId: ownKey.id, unitId: unit.EG, share: 400 },
			{ accountId: 'a', keyId: ownKey.id, unitId: unit.OG, share: 600 }
		]);
		const [water] = await db
			.insert(costItems)
			.values({
				accountId: 'a',
				propertyId,
				categoryId: category.Hauswart,
				allocationKeyId: direct.id,
				billingCircleId: circle.id,
				description: 'Wasser laut Messdienst',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 30000
			})
			.returning({ id: costItems.id });
		await db.insert(costItemUnitAmounts).values([
			{ accountId: 'a', costItemId: water.id, unitId: unit.OG, amount: 10000 },
			{ accountId: 'a', costItemId: water.id, unitId: unit.DG, amount: 20000 }
		]);

		const input = (await loadStatementInput(db, 'a', propertyId, period))!;
		const garageLease = input.leases.find((lease) => lease.id === created.id)!;
		// Only the garage is in this property; the main unit of the lease is not.
		expect(garageLease.unitIds).toEqual([garage.id]);
		expect(input.circles).toEqual([
			{ id: circle.id, name: 'Aufzug', unitIds: expect.arrayContaining([unit.OG, unit.DG]) }
		]);
		expect(input.items.find((item) => item.id === water.id)!.unitAmounts).toEqual(
			expect.arrayContaining([
				{ unitId: unit.OG, amount: 10000 },
				{ unitId: unit.DG, amount: 20000 }
			])
		);
		const keyIds = input.keys.map((key) => key.id);
		expect(keyIds).toContain(direct.id);
		expect(keyIds).not.toContain(foreignKey.id);
		expect(input.keys.find((key) => key.id === ownKey.id)!.shares).toEqual(
			expect.arrayContaining([
				{ unitId: unit.EG, share: 400 },
				{ unitId: unit.OG, share: 600 }
			])
		);
	});
});

describe('createStatement and getStatement', () => {
	it('creates a draft with the stored result and recomputes it on view', async () => {
		const { propertyId } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		const view = (await getStatement(db, 'a', id))!;
		expect(view.statement).toMatchObject({ status: 'draft', version: 1, correctsId: null });
		expect(view.periodLabel).toBe('2025');
		expect(view.result.leases).toHaveLength(4);
		expect(view.result.property.costsTotal).toBe(620000);
		expect(view.blocking).toEqual([]);
		expect(view.leaseResults).toEqual([]);
		expect(view.correctedBy).toBeNull();
		expect(view.superseded).toBe(false);

		const [row] = await db.select().from(operatingCostStatements);
		expect(JSON.parse(row.result!)).toMatchObject({ costsTotal: 620000 });
		const audit = await db.select().from(auditLog).where(eq(auditLog.entity, 'statement'));
		expect(audit.map((entry) => [entry.action, entry.summary])).toEqual([
			['create', 'Betriebskostenabrechnung 2025 für Lindenstraße 4 als Entwurf angelegt']
		]);

		const groups = await listStatements(db, 'a');
		expect(groups).toHaveLength(1);
		expect(groups[0].property.name).toBe('Lindenstraße 4');
		expect(groups[0].statements[0]).toMatchObject({
			id,
			periodLabel: '2025',
			status: 'draft',
			leaseCount: 4,
			nachzahlungen: 10599 + 4597,
			guthaben: 10567 + 20213,
			superseded: false
		});
		expect(await listPropertiesForStatements(db, 'a')).toEqual([
			{ id: propertyId, name: 'Lindenstraße 4', hasCostItems: true }
		]);
	});

	it('refuses a second statement for the same period and an invalid period', async () => {
		const { propertyId } = await seedScenario(db, 'a');
		await draft(db, propertyId);
		expect(
			await createStatement(db, contextA, {
				propertyId,
				periodStart: period.start,
				periodEnd: period.end
			})
		).toEqual({
			ok: false,
			message: 'Für dieses Objekt und diesen Zeitraum gibt es schon einen Entwurf.'
		});
		expect(
			await createStatement(db, contextA, {
				propertyId,
				periodStart: '2024-01-01',
				periodEnd: '2025-01-31'
			})
		).toMatchObject({ ok: false, message: expect.stringContaining('höchstens 12 Monate') });
		expect(
			await createStatement(db, contextA, {
				propertyId,
				periodStart: '2024-01-15',
				periodEnd: '2025-01-14'
			})
		).toMatchObject({ ok: false, message: expect.stringContaining('am Ersten eines Monats') });
	});

	it('refuses a period that overlaps another statement of the property', async () => {
		const { propertyId } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		const overlapping = {
			propertyId,
			periodStart: '2025-07-01',
			periodEnd: '2026-06-30'
		};
		expect(await createStatement(db, contextA, overlapping)).toEqual({
			ok: false,
			message:
				'Der Zeitraum überschneidet sich mit der Abrechnung 2025 (Entwurf); jeder Monat darf nur einmal abgerechnet werden.'
		});
		await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null });
		expect(
			await createStatement(db, contextA, {
				propertyId,
				periodStart: '2024-07-01',
				periodEnd: '2025-01-31'
			})
		).toMatchObject({ ok: false, message: expect.stringContaining('2025 (freigegeben)') });
		// The year before and the year after are fine, and so is the same year in another account.
		expect(
			(
				await createStatement(db, contextA, {
					propertyId,
					periodStart: '2024-01-01',
					periodEnd: '2024-12-31'
				})
			).ok
		).toBe(true);
		expect(
			(
				await createStatement(db, contextA, {
					propertyId,
					periodStart: '2026-01-01',
					periodEnd: '2026-06-30'
				})
			).ok
		).toBe(true);
		const { propertyId: other } = await seedScenario(db, 'b');
		expect((await createStatement(db, contextB, { ...overlapping, propertyId: other })).ok).toBe(
			true
		);
	});
});

/**
 * One lease of 600\u00a0€ rent plus 150 + 50\u00a0€ prepayments from 1 January of the year, a
 * Grundsteuer bill of 3.000\u00a0€ for the year (by area) and the rent of the first `paidMonths`
 * months paid on 31 December. All paid, the balance is 3.000 − 12 × 200 = 600\u00a0€ Nachzahlung.
 */
async function seedSingleLease(db: Database, year: number, paidMonths: number) {
	const { propertyId, unitId } = await seedUnit(db, 'a');
	const lease = await createLease(db, contextA, leaseInput(unitId, { startDate: `${year}-01-01` }));
	if (!lease.ok) throw new Error(lease.reason);
	const [category] = await db
		.insert(costCategories)
		.values({ accountId: 'a', name: 'Grundsteuer' })
		.returning({ id: costCategories.id });
	const [key] = await db
		.insert(allocationKeys)
		.values({ accountId: 'a', name: 'Wohnfläche', kind: 'area' })
		.returning({ id: allocationKeys.id });
	await db.insert(costItems).values({
		accountId: 'a',
		propertyId,
		categoryId: category.id,
		allocationKeyId: key.id,
		description: `Grundsteuer ${year}`,
		periodStart: `${year}-01-01`,
		periodEnd: `${year}-12-31`,
		amount: 300000
	});
	if (paidMonths > 0) {
		await db.insert(payments).values({
			accountId: 'a',
			leaseId: lease.id,
			date: `${year}-12-31`,
			amount: paidMonths * 80000
		});
	}
	return { propertyId, leaseId: lease.id };
}

describe('approveStatement', () => {
	it('freezes the results and posts one charge per lease', async () => {
		const { propertyId, leaseIds } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		expect(
			await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null })
		).toEqual({
			ok: true,
			id
		});

		const view = (await getStatement(db, 'a', id))!;
		const approvedOn = today();
		expect(view.statement).toMatchObject({ status: 'approved', approvedBy: 'user-a' });
		expect(view.statement.approvedAt).toBeInstanceOf(Date);
		const creditDue = addDays(approvedOn, 30);
		expect(view.result.property).toMatchObject({ approvedOn, costsTotal: 620000 });
		// A Guthaben is due 30 days after the approval, a Nachzahlung only once delivered.
		expect(
			view.leaseResults.map((row) => [row.leaseId, row.balance, row.deliveredOn, row.dueDate])
		).toEqual(
			expect.arrayContaining([
				[leaseIds.eg, -10567, null, creditDue],
				[leaseIds.ogA, 10599, null, null],
				[leaseIds.ogB, 4597, null, null],
				[leaseIds.dg, -20213, null, creditDue]
			])
		);
		for (const lease of view.result.leases) {
			expect(lease.approvedOn).toBe(approvedOn);
			expect(lease.posted).toBe(lease.balance);
			expect(lease.dueDate).toBe(lease.balance > 0 ? null : creditDue);
		}

		// One statement_balance charge per lease; a Nachzahlung has no due date before delivery.
		const charges = await db
			.select()
			.from(rentCharges)
			.where(and(eq(rentCharges.accountId, 'a'), eq(rentCharges.kind, 'statement_balance')));
		expect(charges.map((charge) => [charge.leaseId, charge.amount, charge.dueDate]).sort()).toEqual(
			[
				[leaseIds.eg, -10567, creditDue],
				[leaseIds.ogA, 10599, null],
				[leaseIds.ogB, 4597, null],
				[leaseIds.dg, -20213, creditDue]
			].sort()
		);
		for (const charge of charges) {
			expect(charge).toMatchObject({ period: '2025-12', referenceId: id, reversesChargeId: null });
		}
		expect(charges.find((charge) => charge.leaseId === leaseIds.ogA)!.note).toBe(
			'Betriebskostenabrechnung 2025; fällig 30 Tage nach Zugang'
		);

		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'approve'));
		expect(audit).toHaveLength(1);
		expect(audit[0].summary).toBe(
			'Betriebskostenabrechnung 2025 für Lindenstraße 4 freigegeben: 4\u00a0Mietverträge, Nachzahlungen 151,96\u00a0€, Guthaben 307,80\u00a0€'
		);

		// The frozen per-lease result is what the PDF reads.
		const frozen = (await getLeaseResult(db, 'a', id, leaseIds.eg))!;
		expect(frozen).toMatchObject({ leaseId: leaseIds.eg, balance: -10567, approvedOn });
		expect(await getLeaseResult(db, 'b', id, leaseIds.eg)).toBeUndefined();
	});

	it('refuses a second approval and a draft with a blocking warning', async () => {
		const { propertyId, meter, unit } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		// Without the end reading of the EG meter the heating cost cannot be split.
		await db
			.delete(meterReadings)
			.where(
				and(eq(meterReadings.meterId, meter[unit.EG]), eq(meterReadings.readAt, '2025-12-31'))
			);
		const view = (await getStatement(db, 'a', id))!;
		expect(view.blocking.map((warning) => warning.code)).toEqual(['missing_reading']);
		const blocked = await approveStatement(db, contextA, id, {
			lateApprovalJustified: false,
			note: null
		});
		expect(blocked).toMatchObject({
			ok: false,
			message: expect.stringContaining('kann noch nicht freigegeben werden')
		});
		await db.insert(meterReadings).values({
			accountId: 'a',
			meterId: meter[unit.EG],
			readAt: '2025-12-31',
			value: 1000,
			estimated: true
		});
		expect(
			(await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null })).ok
		).toBe(true);
		expect(
			await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null })
		).toEqual({
			ok: false,
			message: 'Diese Abrechnung ist schon freigegeben.'
		});
		expect(await deleteDraft(db, contextA, id)).toBe(false);
	});

	it('posts 0 for a late residential Nachzahlung unless the delay is justified', async () => {
		// A statement for 2024 approved today (2026): the deadline of 31 December 2025 has passed.
		const { propertyId, leaseId } = await seedSingleLease(db, 2024, 12);
		const create = async () =>
			createStatement(db, contextA, {
				propertyId,
				periodStart: '2024-01-01',
				periodEnd: '2024-12-31'
			});

		const first = await create();
		if (!first.ok) throw new Error(first.message);
		const view = (await getStatement(db, 'a', first.id))!;
		expect(view.result.property.late).toBe(true);
		expect(view.result.property.warnings.map((w) => w.code)).toContain('deadline_passed');
		expect(view.result.leases[0].balance).toBe(60000);
		// The checkbox without a note is refused.
		expect(
			await approveStatement(db, contextA, first.id, { lateApprovalJustified: true, note: null })
		).toMatchObject({
			ok: false
		});
		expect(
			(await approveStatement(db, contextA, first.id, { lateApprovalJustified: false, note: null }))
				.ok
		).toBe(true);
		const [charge] = await chargesOf(db, leaseId);
		expect(charge.amount).toBe(0);
		expect(charge.note).toBe(
			'Betriebskostenabrechnung 2024; Nachzahlung 600,00\u00a0€ nach Ablauf der Abrechnungsfrist nicht verlangt (§ 556 Abs. 3 BGB)'
		);
		const frozen = (await getLeaseResult(db, 'a', first.id, leaseId))!;
		expect(frozen).toMatchObject({ balance: 60000, posted: 0, late: true });

		// A correction approved with the justification posts the Nachzahlung.
		const correction = await createCorrection(db, contextA, first.id);
		if (!correction.ok) throw new Error(correction.message);
		expect(
			(
				await approveStatement(db, contextA, correction.id, {
					lateApprovalJustified: true,
					note: 'Belege kamen verspätet'
				})
			).ok
		).toBe(true);
		const charges = await chargesOf(db, leaseId);
		expect(charges.map((row) => `${row.amount} ${row.reversesChargeId === null}`).sort()).toEqual([
			'0 false',
			'0 true',
			'60000 true'
		]);
		expect((await getStatement(db, 'a', correction.id))!.statement).toMatchObject({
			lateApprovalJustified: true,
			note: 'Belege kamen verspätet'
		});
	});
});

describe('paid prepayments', () => {
	it('credits only the paid prepayments and posts the claim less the unpaid ones', async () => {
		// December's rent of 800\u00a0€ is open: 11 × 200\u00a0€ prepayments paid, 200\u00a0€ not.
		const { propertyId, leaseId } = await seedSingleLease(db, 2025, 11);
		const id = await draft(db, propertyId);
		const lease = (await getStatement(db, 'a', id))!.result.leases[0];
		expect(lease.prepayments.at(-1)).toEqual({
			period: '2025-12',
			charged: 20000,
			operatingCostPrepayment: 0,
			heatingCostPrepayment: 0,
			amount: 0,
			source: 'ledger'
		});
		expect(lease).toMatchObject({
			prepaymentsTotal: 220000,
			unpaidPrepayments: 20000,
			balance: 80000
		});
		await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null });

		// The claim is the Nachzahlung of 800\u00a0€. The open December rent still holds 200\u00a0€ of
		// it, so the posting is 600\u00a0€: the rent account adds up to the claim, nothing twice.
		const frozen = (await getLeaseResult(db, 'a', id, leaseId))!;
		expect(frozen).toMatchObject({ balance: 80000, posted: 80000, dueDate: null });
		const [posting] = await chargesOf(db, leaseId);
		expect(posting).toMatchObject({ amount: 60000, dueDate: null });
		expect(posting.note).toBe(
			'Betriebskostenabrechnung 2025; abzüglich 200,00\u00a0€ nicht geleisteter Vorauszahlungen, die schon als Soll gebucht sind; fällig 30 Tage nach Zugang'
		);
		const letter = statementLetter(frozen);
		const tables = letter.blocks!.flatMap((block) => ('table' in block ? [block.table] : []));
		expect(tables[1].rows.at(-1)).toEqual([
			'Dezember 2025',
			'200,00\u00a0€',
			'0,00\u00a0€',
			'0,00\u00a0€',
			'0,00\u00a0€'
		]);
		expect(tables[1].footer).toEqual(['Summe', '2.400,00\u00a0€', '', '', '2.200,00\u00a0€']);
		const paragraphs = letter.blocks!.flatMap((block) =>
			'paragraph' in block ? [block.paragraph] : []
		);
		expect(paragraphs).toContain(
			'Von den Vorauszahlungen für den Abrechnungszeitraum (2.400,00\u00a0€) haben Sie 200,00\u00a0€ nicht geleistet. Die Abrechnung rechnet nur die geleisteten an; die offenen Vorauszahlungen sind im Ergebnis enthalten und werden nicht zusätzlich verlangt.'
		);
		expect(paragraphs).toContain(
			'Kosten gesamt 3.000,00\u00a0€, geleistete Vorauszahlungen 2.200,00\u00a0€: Nachzahlung 800,00\u00a0€.'
		);
		expect(paragraphs).toContain(
			'Bitte überweisen Sie die Nachzahlung von 800,00\u00a0€ innerhalb von 30 Tagen nach Zugang dieser Abrechnung.'
		);
	});

	it('keeps the unpaid prepayments claimable after the deadline', async () => {
		// 2024, approved today after the deadline: the Nachzahlung of 800\u00a0€ is excluded except for
		// the 200\u00a0€ of December's prepayments the tenant did not pay (BGH VIII ZR 261/06).
		const { propertyId, leaseId } = await seedSingleLease(db, 2024, 11);
		const created = await createStatement(db, contextA, {
			propertyId,
			periodStart: '2024-01-01',
			periodEnd: '2024-12-31'
		});
		if (!created.ok) throw new Error(created.message);
		await approveStatement(db, contextA, created.id, { lateApprovalJustified: false, note: null });
		const frozen = (await getLeaseResult(db, 'a', created.id, leaseId))!;
		expect(frozen).toMatchObject({ balance: 80000, unpaidPrepayments: 20000, posted: 20000 });
		// The open December rent holds the 200\u00a0€ already; the posting adds nothing.
		expect((await chargesOf(db, leaseId)).map((row) => row.amount)).toEqual([0]);
		const paragraphs = statementLetter(frozen).blocks!.flatMap((block) =>
			'paragraph' in block ? [block.paragraph] : []
		);
		expect(paragraphs).toContain(
			'Die Abrechnung erreicht Sie nach Ablauf der Abrechnungsfrist (§ 556 Abs. 3 BGB); von der Nachzahlung verlangen wir nur die 200,00\u00a0€ Vorauszahlungen, die Sie nicht geleistet haben. Bitte überweisen Sie die Nachzahlung von 200,00\u00a0€ innerhalb von 30 Tagen nach Zugang dieser Abrechnung.'
		);
	});

	it('refuses to approve a period that has not ended', async () => {
		travelTo('2025-12-31');
		const { propertyId } = await seedSingleLease(db, 2025, 12);
		const id = await draft(db, propertyId);
		expect(
			await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null })
		).toEqual({
			ok: false,
			message:
				'Der Abrechnungszeitraum endet am 31.12.2025; freigeben kannst du die Abrechnung erst danach.'
		});
		travelTo('2026-01-01');
		expect(
			(await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null })).ok
		).toBe(true);
	});
});

describe('quotas', () => {
	it('refuses statements and results beyond the limits with 409', async () => {
		const { propertyId } = await seedScenario(db, 'a');
		const statementMax = QUOTAS.operatingCostStatements.max;
		const resultMax = QUOTAS.statementResults.max;
		try {
			QUOTAS.operatingCostStatements.max = 0;
			const refused = await draft(db, propertyId).catch((error) => error);
			expect(isHttpError(refused, 409)).toBe(true);
			QUOTAS.operatingCostStatements.max = statementMax;
			const id = await draft(db, propertyId);
			// Four leases, four results: one too many.
			QUOTAS.statementResults.max = 3;
			const blocked = await approveStatement(db, contextA, id, {
				lateApprovalJustified: false,
				note: null
			}).catch((error) => error);
			expect(isHttpError(blocked, 409)).toBe(true);
			expect(await db.select().from(statementResults)).toEqual([]);
		} finally {
			QUOTAS.operatingCostStatements.max = statementMax;
			QUOTAS.statementResults.max = resultMax;
		}
	});
});

describe('approving a correction after the deadline', () => {
	it('keeps the result that was claimed in time', async () => {
		// The 2025 statement is approved on 15.06.2026, in time: EG −105,67, OG A +105,99,
		// OG B +45,97, DG −202,13 are posted.
		travelTo('2026-06-15');
		const { propertyId, leaseIds, category, key } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null });

		// A forgotten Grundsteuer bill of 365 € by area, corrected on 10.02.2027 after the
		// deadline of 31.12.2026: EG 143,43, OG 126,61 (A 62,78, B 63,83), DG 94,96 (lease 63,22,
		// vacancy 31,74), so the balances become EG +37,76, OG A +168,77, OG B +109,80, DG −138,91.
		travelTo('2027-02-10');
		await db.insert(costItems).values({
			accountId: 'a',
			propertyId,
			categoryId: category.Grundsteuer,
			allocationKeyId: key.Wohnfläche,
			description: 'Grundsteuer Nachveranlagung',
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			amount: 36500
		});
		const correction = await createCorrection(db, contextA, id);
		if (!correction.ok) throw new Error(correction.message);
		expect(
			(
				await approveStatement(db, contextA, correction.id, {
					lateApprovalJustified: false,
					note: null
				})
			).ok
		).toBe(true);

		// Each lease: the old posting, its reversal, and the new posting, which § 556 Abs. 3 BGB
		// holds to the old one: no Nachzahlung above it, no Guthaben below it.
		const amounts = (leaseId: string) => postings(db, leaseId, [id, correction.id]);
		expect(await amounts(leaseIds.eg)).toEqual([-10567, 10567, -10567]);
		expect(await amounts(leaseIds.ogA)).toEqual([10599, -10599, 10599]);
		expect(await amounts(leaseIds.ogB)).toEqual([4597, -4597, 4597]);
		expect(await amounts(leaseIds.dg)).toEqual([-20213, 20213, -20213]);
		const frozen = (await getLeaseResult(db, 'a', correction.id, leaseIds.ogA))!;
		expect(frozen).toMatchObject({ balance: 16877, posted: 10599, late: true });
		const posted = (await chargesOf(db, leaseIds.ogA)).find(
			(row) => row.referenceId === correction.id && row.reversesChargeId === null
		)!;
		expect(posted.note).toContain(
			'Ergebnis 168,77\u00a0€ nach Ablauf der Abrechnungsfrist auf 105,99\u00a0€ begrenzt'
		);
		const paragraphs = statementLetter(frozen).blocks!.flatMap((block) =>
			'paragraph' in block ? [block.paragraph] : []
		);
		expect(paragraphs).toContain(
			'Nach Ablauf der Abrechnungsfrist (§ 556 Abs. 3 BGB) gilt das rechtzeitig abgerechnete Ergebnis. Bitte überweisen Sie die Nachzahlung von 105,99\u00a0€ innerhalb von 30 Tagen nach Zugang dieser Abrechnung.'
		);

		// A lower result still lowers the claim: a credit note of 730 € by area.
		await db.insert(costItems).values({
			accountId: 'a',
			propertyId,
			categoryId: category.Grundsteuer,
			allocationKeyId: key.Wohnfläche,
			description: 'Grundsteuer Erstattung',
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			amount: -73000
		});
		const second = await createCorrection(db, contextA, correction.id);
		if (!second.ok) throw new Error(second.message);
		await approveStatement(db, contextA, second.id, { lateApprovalJustified: false, note: null });
		// OG's share of −730 € is −253,22 €, A's −125,57 € (181 / 365 days, with the remainder):
		// 168,77 − 125,57 = 43,20 €, below the 105,99 € claimed in time, so it is posted.
		const ogA = (await getLeaseResult(db, 'a', second.id, leaseIds.ogA))!;
		expect(ogA).toMatchObject({ balance: 4320, posted: 4320 });
		expect(await postings(db, leaseIds.ogA, [second.id])).toEqual([-10599, 4320]);
	});

	it('holds a correction delivered after the deadline to the version delivered in time', async () => {
		// The 2025 statement reaches OG A in time on 15.06.2026 with +105,99 €.
		travelTo('2026-06-15');
		const { propertyId, leaseIds, category, key } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null });
		await setDelivered(db, contextA, id, leaseIds.ogA, '2026-06-15');

		// The Grundsteuer correction (OG A +168,77 €) is approved on 15.12.2026, before the deadline,
		// but reaches OG A only on 05.01.2027: the 62,78 € above the first version are reversed.
		travelTo('2026-12-15');
		await db.insert(costItems).values({
			accountId: 'a',
			propertyId,
			categoryId: category.Grundsteuer,
			allocationKeyId: key.Wohnfläche,
			description: 'Grundsteuer Nachveranlagung',
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			amount: 36500
		});
		const correction = await createCorrection(db, contextA, id);
		if (!correction.ok) throw new Error(correction.message);
		await approveStatement(db, contextA, correction.id, {
			lateApprovalJustified: false,
			note: null
		});
		travelTo('2027-01-10');
		expect(await setDelivered(db, contextA, correction.id, leaseIds.ogA, '2027-01-05')).toEqual({
			ok: true,
			reversed: 6278
		});
		expect(await postings(db, leaseIds.ogA, [id, correction.id])).toEqual([
			10599, -10599, -6278, 16877
		]);
		const reversal = (await chargesOf(db, leaseIds.ogA)).find(
			(row) => row.referenceId === correction.id && row.amount === -6278
		)!;
		expect(reversal.dueDate).toBe('2027-02-04');
		expect(reversal.note).toContain('in Höhe von 62,78\u00a0€ ausgeschlossen');
		expect(
			(await getStatement(db, 'a', correction.id))!.leaseResults.find(
				(row) => row.leaseId === leaseIds.ogA
			)
		).toMatchObject({ reversedOnDelivery: 6278 });

		// A further correction takes back only what is left of that posting and posts no more.
		const second = await createCorrection(db, contextA, correction.id);
		if (!second.ok) throw new Error(second.message);
		await approveStatement(db, contextA, second.id, { lateApprovalJustified: false, note: null });
		expect(await postings(db, leaseIds.ogA, [second.id])).toEqual([-10599, 10599]);
		const total = (await chargesOf(db, leaseIds.ogA)).reduce((sum, row) => sum + row.amount, 0);
		expect(total).toBe(10599);
	});
});

describe('createCorrection', () => {
	it('creates a new version whose approval reverses the old charges', async () => {
		const { propertyId, leaseIds, category, key } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		expect(await createCorrection(db, contextA, id)).toEqual({
			ok: false,
			message: 'Nur eine freigegebene Abrechnung kann korrigiert werden.'
		});
		await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null });
		expect(await createCorrection(db, contextA, 'missing')).toMatchObject({ ok: false });

		// A forgotten receipt: 365\u00a0€ more Grundsteuer, 1\u00a0€ per day.
		await db.insert(costItems).values({
			accountId: 'a',
			propertyId,
			categoryId: category.Grundsteuer,
			allocationKeyId: key.Wohnfläche,
			description: 'Grundsteuer Nachveranlagung',
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			amount: 36500
		});
		const correction = await createCorrection(db, contextA, id);
		expect(correction.ok).toBe(true);
		if (!correction.ok) return;
		const draftView = (await getStatement(db, 'a', correction.id))!;
		expect(draftView.statement).toMatchObject({ status: 'draft', version: 2, correctsId: id });
		expect(draftView.corrects).toEqual({ id, version: 1 });
		expect(draftView.result.property.costsTotal).toBe(620000 + 36500);
		// The original now knows about its correction, but is not superseded by a draft.
		const original = (await getStatement(db, 'a', id))!;
		expect(original.correctedBy).toEqual({ id: correction.id, version: 2, status: 'draft' });
		expect(original.superseded).toBe(false);
		expect(await createCorrection(db, contextA, id)).toEqual({
			ok: false,
			message: 'Zu dieser Abrechnung gibt es schon einen Korrekturentwurf.'
		});
		const groups = await listStatements(db, 'a');
		expect(groups[0].statements.map((s) => [s.version, s.status])).toEqual([
			[2, 'draft'],
			[1, 'approved']
		]);

		expect(
			(
				await approveStatement(db, contextA, correction.id, {
					lateApprovalJustified: false,
					note: null
				})
			).ok
		).toBe(true);
		expect((await getStatement(db, 'a', id))!.superseded).toBe(true);
		expect((await listStatements(db, 'a'))[0].statements[1].superseded).toBe(true);

		// EG: the old charge −105,67\u00a0€, its reversal +105,67\u00a0€ and the new balance. The extra
		// 365 € × 72,5 / 184,5 m² = 143,428… → 143,43\u00a0€ make the new balance 37,76\u00a0€.
		const eg = await chargesOf(db, leaseIds.eg);
		const firstCharge = eg.find((row) => row.referenceId === id)!;
		const reversal = eg.find((row) => row.reversesChargeId !== null)!;
		const posted = eg.find((row) => row.referenceId === correction.id && !row.reversesChargeId)!;
		expect(eg).toHaveLength(3);
		expect(firstCharge.amount).toBe(-10567);
		// The reversal is due when the posting it cancels is; the new Nachzahlung once delivered.
		expect(reversal).toMatchObject({
			amount: 10567,
			reversesChargeId: firstCharge.id,
			dueDate: firstCharge.dueDate
		});
		expect(posted).toMatchObject({ amount: 3776, dueDate: null });
		expect(reversal.note).toContain('Storno');
		// Every lease got its reversal and its new posting.
		for (const leaseId of Object.values(leaseIds)) {
			expect(await chargesOf(db, leaseId)).toHaveLength(3);
		}
		expect(await createCorrection(db, contextA, id)).toEqual({
			ok: false,
			message: 'Diese Abrechnung wurde schon korrigiert; korrigiere die neueste Version.'
		});
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'correct'));
		expect(audit[0].summary).toBe(
			'Korrektur (Version 2) der Betriebskostenabrechnung 2025 für Lindenstraße 4 als Entwurf angelegt'
		);
	});
});

describe('setDelivered and deleteDraft', () => {
	it('records the delivery date and the Einwendungsfrist', async () => {
		travelTo('2026-03-10');
		const { propertyId, leaseIds } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		expect(await setDelivered(db, contextA, id, leaseIds.eg, '2026-03-15')).toEqual({
			ok: false,
			message: 'Zu diesem Mietvertrag gibt es kein Ergebnis.'
		});
		await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null });
		travelTo('2026-03-20');
		expect(await setDelivered(db, contextA, id, leaseIds.eg, '2026-03-15')).toEqual({
			ok: true,
			reversed: 0
		});
		const view = (await getStatement(db, 'a', id))!;
		// § 556 Abs. 3 Satz 5 BGB: received 15.03.2026, objections until the end of March 2027.
		expect(view.leaseResults.find((row) => row.leaseId === leaseIds.eg)).toMatchObject({
			deliveredOn: '2026-03-15',
			objectionDeadline: '2027-03-31',
			reversedOnDelivery: 0,
			active: true
		});
		// The DG lease ended in August 2025: no prepayment adjustment for it.
		expect(view.leaseResults.find((row) => row.leaseId === leaseIds.dg)?.active).toBe(false);
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'update'));
		expect(audit[0].summary).toBe(
			'Betriebskostenabrechnung 2025 für EG · Max Müller am 15.03.2026 zugestellt'
		);
	});

	it('refuses a delivery before the approval or in the future', async () => {
		travelTo('2026-03-10');
		const { propertyId, leaseIds } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null });
		expect(await setDelivered(db, contextA, id, leaseIds.eg, '2026-03-09')).toEqual({
			ok: false,
			message:
				'Die Abrechnung wurde am 10.03.2026 freigegeben; sie kann nicht vorher zugestellt worden sein.'
		});
		expect(await setDelivered(db, contextA, id, leaseIds.eg, '2026-03-11')).toEqual({
			ok: false,
			message: 'Das Datum der Zustellung liegt in der Zukunft.'
		});
		expect((await getStatement(db, 'a', id))!.leaseResults[0].deliveredOn).toBeNull();
	});

	it('reverses a Nachzahlung that reaches the tenant after the deadline', async () => {
		// Approved on 15.12.2026, before the deadline of 31.12.2026: OG A +105,99 and OG B +45,97
		// are posted. OG A receives it on 20.12.2026, OG B only on 05.01.2027, too late.
		travelTo('2026-12-15');
		const { propertyId, leaseIds } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null });
		travelTo('2027-01-10');
		expect(await setDelivered(db, contextA, id, leaseIds.ogA, '2026-12-20')).toEqual({
			ok: true,
			reversed: 0
		});
		// OG A's Nachzahlung falls due 30 days after the delivery.
		const [ogAPosting] = await chargesOf(db, leaseIds.ogA);
		expect(ogAPosting).toMatchObject({ amount: 10599, dueDate: '2027-01-19' });
		expect(
			(await getStatement(db, 'a', id))!.leaseResults.find((row) => row.leaseId === leaseIds.ogA)
		).toMatchObject({ deliveredOn: '2026-12-20', dueDate: '2027-01-19' });
		// Correcting the date moves the due date along.
		await setDelivered(db, contextA, id, leaseIds.ogA, '2026-12-22');
		expect((await chargesOf(db, leaseIds.ogA))[0].dueDate).toBe('2027-01-21');
		expect(await setDelivered(db, contextA, id, leaseIds.ogB, '2027-01-05')).toEqual({
			ok: true,
			reversed: 4597
		});
		// A Guthaben stays, however late it arrives.
		expect(await setDelivered(db, contextA, id, leaseIds.eg, '2027-01-05')).toEqual({
			ok: true,
			reversed: 0
		});
		const ogB = await chargesOf(db, leaseIds.ogB);
		const original = ogB.find((row) => row.reversesChargeId === null)!;
		const reversal = ogB.find((row) => row.reversesChargeId !== null)!;
		expect(original).toMatchObject({ amount: 4597, dueDate: '2027-02-04' });
		expect(reversal).toMatchObject({
			amount: -4597,
			reversesChargeId: original.id,
			referenceId: id,
			dueDate: '2027-02-04'
		});
		expect(reversal.note).toContain('nach Ablauf der Abrechnungsfrist am 31.12.2026');
		expect((await chargesOf(db, leaseIds.ogA)).map((row) => row.amount)).toEqual([10599]);
		const view = (await getStatement(db, 'a', id))!;
		expect(view.leaseResults.find((row) => row.leaseId === leaseIds.ogB)).toMatchObject({
			deliveredOn: '2027-01-05',
			reversedOnDelivery: 4597
		});
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'update'));
		expect(audit.map((entry) => entry.summary)).toContain(
			'Betriebskostenabrechnung 2025 für OG · Bernd Neu am 05.01.2027 zugestellt; Nachzahlung 45,97\u00a0€ nach Ablauf der Abrechnungsfrist storniert'
		);
		// Saving the date again reverses nothing twice; an earlier date cannot undo the reversal.
		expect(await setDelivered(db, contextA, id, leaseIds.ogB, '2027-01-06')).toEqual({
			ok: true,
			reversed: 0
		});
		expect(await setDelivered(db, contextA, id, leaseIds.ogB, '2026-12-30')).toMatchObject({
			ok: false,
			message: expect.stringContaining('schon storniert')
		});
		expect(await chargesOf(db, leaseIds.ogB)).toHaveLength(2);

		// A correction approved now (late) keeps the claims that reached the tenants in time: OG A
		// its 105,99 €, OG B nothing; the reversed posting is not reversed again.
		const correction = await createCorrection(db, contextA, id);
		if (!correction.ok) throw new Error(correction.message);
		expect(
			(
				await approveStatement(db, contextA, correction.id, {
					lateApprovalJustified: false,
					note: null
				})
			).ok
		).toBe(true);
		// Statement 1: its reversal on delivery, then its posting; the correction: its new posting.
		expect(await postings(db, leaseIds.ogB, [id, correction.id])).toEqual([-4597, 4597, 0]);
		expect(await postings(db, leaseIds.ogA, [id, correction.id])).toEqual([10599, -10599, 10599]);
		// The reversal of OG A's delivered posting is due with it; the new posting once delivered.
		const ogA = await chargesOf(db, leaseIds.ogA);
		expect(ogA.find((row) => row.reversesChargeId !== null)!.dueDate).toBe('2027-01-21');
		expect(
			ogA.find((row) => row.referenceId === correction.id && row.reversesChargeId === null)!.dueDate
		).toBeNull();
	});

	it('deletes a draft with an audit line', async () => {
		const { propertyId } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		expect(await deleteDraft(db, contextA, id)).toBe(true);
		expect(await getStatement(db, 'a', id)).toBeUndefined();
		expect(await deleteDraft(db, contextA, id)).toBe(false);
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'delete'));
		expect(audit[0].summary).toBe(
			'Entwurf der Betriebskostenabrechnung 2025 für Lindenstraße 4 gelöscht'
		);
	});
});

describe('account isolation', () => {
	it('does not leak into another account', async () => {
		const { propertyId, leaseIds } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		expect(
			await createStatement(db, contextB, {
				propertyId,
				periodStart: period.start,
				periodEnd: period.end
			})
		).toEqual({ ok: false, message: 'Dieses Objekt gibt es nicht.' });
		expect(await getStatement(db, 'b', id)).toBeUndefined();
		expect(await listStatements(db, 'b')).toEqual([]);
		expect(await listPropertiesForStatements(db, 'b')).toEqual([]);
		expect(
			await approveStatement(db, contextB, id, { lateApprovalJustified: false, note: null })
		).toEqual({
			ok: false,
			message: 'Diese Abrechnung gibt es nicht.'
		});
		expect(await deleteDraft(db, contextB, id)).toBe(false);
		await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null });
		expect(await createCorrection(db, contextB, id)).toMatchObject({ ok: false });
		expect(await setDelivered(db, contextB, id, leaseIds.eg, today())).toMatchObject({
			ok: false
		});
		expect(await getLeaseResult(db, 'b', id, leaseIds.eg)).toBeUndefined();
		expect(
			await db.select().from(statementResults).where(eq(statementResults.accountId, 'b'))
		).toEqual([]);
		expect(await db.select().from(auditLog).where(eq(auditLog.accountId, 'b'))).toEqual([]);
	});
});

describe('statementLetter', () => {
	it('prints the frozen result with the four elements of a valid statement', async () => {
		const { propertyId, leaseIds } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null });
		const ogA = (await getLeaseResult(db, 'a', id, leaseIds.ogA)) as LeaseStatement;
		const letter = statementLetter(ogA);
		expect(letter.subject).toBe('Betriebskostenabrechnung 2025 – Lindenstraße 4, OG');
		expect(letter.sender).toEqual(['Konto A']);
		expect(letter.recipient).toEqual(['Frau Anna Alt', 'Lindenstraße 4', '10115 Berlin']);
		expect(letter.date).toBe(`Berlin, ${today().split('-').reverse().join('.')}`);
		const blocks = letter.blocks!;
		const tables = blocks.flatMap((block) => ('table' in block ? [block.table] : []));
		expect(tables[0].columns.map((column) => column.label)).toEqual([
			'Kostenart',
			'Gesamtkosten',
			'Umlageschlüssel',
			'Ihr Anteil'
		]);
		expect(tables[0].rows).toHaveLength(4);
		// The deducted CO₂ share and the allocated rest, each under its own label.
		expect(tables[0].rows[3][1]).toBe(
			'3.000,00\u00a0€\nabzüglich CO2-Anteil Vermieter 120,00\u00a0€\numgelegt 2.880,00\u00a0€'
		);
		expect(tables[0].rows[3][3]).toBe('698,44\u00a0€');
		expect(tables[0].footer).toEqual(['Summe', '', '', '1.185,99\u00a0€']);
		expect(tables[1].title).toBe('Geleistete Vorauszahlungen');
		expect(tables[1].columns.map((column) => column.label)).toEqual([
			'Monat',
			'Soll',
			'Betriebskosten',
			'Heizkosten',
			'Geleistet'
		]);
		expect(tables[1].rows).toHaveLength(6);
		expect(tables[1].rows[0]).toEqual([
			'Januar 2025',
			'180,00\u00a0€',
			'120,00\u00a0€',
			'60,00\u00a0€',
			'180,00\u00a0€'
		]);
		expect(tables[1].footer).toEqual(['Summe', '1.080,00\u00a0€', '', '', '1.080,00\u00a0€']);
		const paragraphs = blocks.flatMap((block) => ('paragraph' in block ? [block.paragraph] : []));
		expect(paragraphs[0]).toBe('Guten Tag Frau Alt,');
		expect(paragraphs[1]).toContain('01.01.2025 bis 30.06.2025 (181 von 365 Tagen)');
		expect(paragraphs.find((p) => p.startsWith('CO2-Kostenaufteilung'))).toContain(
			'Vermieteranteil 40 %: vom CO2-Preis 300,00\u00a0€ trägt der Vermieter 120,00\u00a0€'
		);
		expect(paragraphs).toContain(
			'Kosten gesamt 1.185,99\u00a0€, geleistete Vorauszahlungen 1.080,00\u00a0€: Nachzahlung 105,99\u00a0€.'
		);
		// A Nachzahlung is due 30 days after the letter reached the tenant.
		expect(paragraphs).toContain(
			'Bitte überweisen Sie die Nachzahlung von 105,99\u00a0€ innerhalb von 30 Tagen nach Zugang dieser Abrechnung.'
		);
		expect(paragraphs.some((p) => p.includes('nicht geleistet'))).toBe(false);
		expect(letter.closing).toEqual(['Mit freundlichen Grüßen', '', 'Konto A']);
		expect(statementFilename(ogA)).toBe('Betriebskostenabrechnung 2025 OG.pdf');

		const eg = (await getLeaseResult(db, 'a', id, leaseIds.eg)) as LeaseStatement;
		const egParagraphs = statementLetter(eg).blocks!.flatMap((block) =>
			'paragraph' in block ? [block.paragraph] : []
		);
		expect(egParagraphs).toContain(
			`Das Guthaben von 105,67\u00a0€ erstatten wir Ihnen bis zum ${addDays(today(), 30).split('-').reverse().join('.')} oder verrechnen es mit der nächsten Miete.`
		);
	});
});

describe('statementLetter variants', () => {
	let base: LeaseStatement;

	beforeEach(async () => {
		const { propertyId, leaseIds } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null });
		base = (await getLeaseResult(db, 'a', id, leaseIds.ogA)) as LeaseStatement;
	});

	function paragraphsOf(statement: LeaseStatement) {
		return statementLetter(statement).blocks!.flatMap((block) =>
			'paragraph' in block ? [block.paragraph] : []
		);
	}

	it('greets tenants without Frau or Herr by full name and addresses them at their own street', () => {
		const letter = statementLetter({
			...base,
			tenants: [
				{
					salutation: null,
					firstName: 'Kim',
					lastName: 'Klein',
					street: 'Neue Str. 1',
					postalCode: '20095',
					city: 'Hamburg'
				},
				{ ...base.tenants[0] }
			],
			landlord: { ...base.landlord, city: 'Potsdam' }
		});
		expect(letter.recipient).toEqual([
			'Kim Klein',
			'Frau Anna Alt',
			'Neue Str. 1',
			'20095 Hamburg'
		]);
		expect(letter.date.startsWith('Potsdam, ')).toBe(true);
		expect(letter.blocks![0]).toEqual({ paragraph: 'Guten Tag Kim Klein, Frau Alt,' });
	});

	it('dates a draft today in the property’s city and adds up the area of flat and parking space', () => {
		const letter = statementLetter({
			...base,
			approvedOn: null,
			landlord: { ...base.landlord, city: null },
			units: [...base.units, { ...base.units[0], name: 'Stellplatz', floorArea: null }]
		});
		expect(letter.date).toBe(`${base.property.city}, ${formatDate(today())}`);
		expect(
			paragraphsOf({ ...base, units: [...base.units, { ...base.units[0], floorArea: null }] })[1]
		).toContain(`Fläche ${formatArea(base.units[0].floorArea!)}`);
	});

	it('greets nobody by name when the lease lists no tenant', () => {
		expect(paragraphsOf({ ...base, tenants: [] })[0]).toBe('Guten Tag,');
	});

	it('lists the persons per period when they changed', () => {
		const intro = paragraphsOf({
			...base,
			persons: [
				{ from: '2025-01-01', to: '2025-03-31', persons: 1 },
				{ from: '2025-04-01', to: '2025-06-30', persons: 3 }
			]
		})[1];
		expect(intro).toContain(
			'1\u00a0Person vom 01.01.2025 bis 31.03.2025, 3\u00a0Personen vom 01.04.2025 bis 30.06.2025.'
		);
	});

	it('names the landlord account for a Nachzahlung', () => {
		const paragraphs = paragraphsOf({
			...base,
			landlord: { ...base.landlord, iban: 'DE02120300000000202051', bankName: 'Testbank' }
		});
		expect(paragraphs).toContain(
			'Bitte überweisen Sie die Nachzahlung von 105,99\u00a0€ innerhalb von 30 Tagen nach Zugang dieser Abrechnung auf das Konto IBAN DE02120300000000202051 bei der Testbank.'
		);
	});

	it('says that nothing is owed when costs and prepayments match', () => {
		const paragraphs = paragraphsOf({ ...base, balance: 0, posted: 0 });
		expect(paragraphs).toContain(
			'Kosten gesamt 1.185,99\u00a0€, geleistete Vorauszahlungen 1.080,00\u00a0€: Kosten und Vorauszahlungen gleichen sich aus.'
		);
		expect(paragraphs).toContain('Es ist nichts zu zahlen und nichts zu erstatten.');
	});

	it('refunds a Guthaben without a date before approval', () => {
		expect(paragraphsOf({ ...base, balance: -500, posted: null, dueDate: null })).toContain(
			'Das Guthaben von 5,00\u00a0€ erstatten wir Ihnen oder verrechnen es mit der nächsten Miete.'
		);
	});

	it('explains what is left of a late Nachzahlung', () => {
		const late = 'Die Abrechnung erreicht Sie nach Ablauf der Abrechnungsfrist (§ 556 Abs. 3 BGB)';
		expect(paragraphsOf({ ...base, posted: 0 })).toContain(
			`${late}; die Nachzahlung von 105,99\u00a0€ wird nicht verlangt.`
		);

		const unpaid = paragraphsOf({ ...base, unpaidPrepayments: 3000, posted: 3000 });
		expect(unpaid.some((p) => p.includes('haben Sie 30,00\u00a0€ nicht geleistet'))).toBe(true);
		expect(unpaid).toContain(
			`${late}; von der Nachzahlung verlangen wir nur die 30,00\u00a0€ Vorauszahlungen, die Sie nicht geleistet haben. Bitte überweisen Sie die Nachzahlung von 30,00\u00a0€ innerhalb von 30 Tagen nach Zugang dieser Abrechnung.`
		);

		// A late correction keeps the result claimed in time.
		expect(paragraphsOf({ ...base, posted: 5000 })).toContain(
			'Nach Ablauf der Abrechnungsfrist (§ 556 Abs. 3 BGB) gilt das rechtzeitig abgerechnete Ergebnis. Bitte überweisen Sie die Nachzahlung von 50,00\u00a0€ innerhalb von 30 Tagen nach Zugang dieser Abrechnung.'
		);
	});

	it('lists the costs left out of the statement', () => {
		const paragraphs = paragraphsOf({
			...base,
			excluded: [
				{
					itemId: 'x',
					description: 'Reparatur',
					categoryName: 'Instandhaltung',
					amount: 12345,
					reason: 'nicht umlagefähig'
				},
				{
					itemId: 'y',
					description: 'Verwaltung',
					categoryName: 'Verwaltungskosten',
					amount: 500,
					reason: 'nicht umlagefähig'
				}
			]
		});
		expect(paragraphs).toContain(
			'Nicht enthalten (nicht umlagefähig): Instandhaltung 123,45\u00a0€, Verwaltungskosten 5,00\u00a0€.'
		);
	});
});
