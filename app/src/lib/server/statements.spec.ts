import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, addMonths, today } from '../dates';
import { computeStatement, type LeaseStatement } from '../domain/statement';
import type { Database } from './db';
import {
	allocationKeys,
	auditLog,
	costCategories,
	costItems,
	meterReadings,
	meters,
	operatingCostStatements,
	properties,
	rentCharges,
	statementResults,
	tenants,
	units
} from './db/schema';
import { createLease } from './leases';
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

const period = { start: '2025-01-01', end: '2025-12-31' };

/**
 * The reference scenario of PROTOTYPE.md as rows (see domain/statement.spec.ts for the hand
 * calculation): Lindenstraße 4 with EG, OG (tenant change on 30 June) and DG (vacant from
 * 1 September), the five cost items and the heat meters.
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
	return { propertyId: property.id, unit, leaseIds, meter, key, category };
}

async function chargesOf(db: Database, leaseId: string) {
	return db
		.select()
		.from(rentCharges)
		.where(and(eq(rentCharges.leaseId, leaseId), eq(rentCharges.kind, 'statement_balance')))
		.orderBy(asc(rentCharges.createdAt), asc(rentCharges.id));
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
		expect(result.property.vacancyShare).toBe(39584);
		expect(result.property.landlordCo2Share).toBe(12000);
	});

	it('is undefined for a property of another account', async () => {
		const { propertyId } = await seedScenario(db, 'b');
		expect(await loadStatementInput(db, 'a', propertyId, period)).toBeUndefined();
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
		expect(JSON.parse(row.result!)).toMatchObject({ resultVersion: 1, costsTotal: 620000 });
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
				periodEnd: '2025-01-01'
			})
		).toMatchObject({ ok: false, message: expect.stringContaining('höchstens 12 Monate') });
	});
});

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
		expect(view.result.property).toMatchObject({
			approvedOn,
			dueDate: addDays(approvedOn, 30),
			costsTotal: 620000
		});
		expect(view.leaseResults.map((row) => [row.leaseId, row.balance, row.deliveredOn])).toEqual(
			expect.arrayContaining([
				[leaseIds.eg, -10567, null],
				[leaseIds.ogA, 10599, null],
				[leaseIds.ogB, 4597, null],
				[leaseIds.dg, -20213, null]
			])
		);
		for (const lease of view.result.leases) {
			expect(lease.approvedOn).toBe(approvedOn);
			expect(lease.posted).toBe(lease.balance);
		}

		// One statement_balance charge per lease, due 30 days after the approval.
		const charges = await db
			.select()
			.from(rentCharges)
			.where(and(eq(rentCharges.accountId, 'a'), eq(rentCharges.kind, 'statement_balance')));
		expect(charges.map((charge) => [charge.leaseId, charge.amount]).sort()).toEqual(
			[
				[leaseIds.eg, -10567],
				[leaseIds.ogA, 10599],
				[leaseIds.ogB, 4597],
				[leaseIds.dg, -20213]
			].sort()
		);
		for (const charge of charges) {
			expect(charge).toMatchObject({
				period: '2025-12',
				dueDate: addDays(approvedOn, 30),
				referenceId: id,
				reversesChargeId: null
			});
		}

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
		const { propertyId, unitId } = await seedUnit(db, 'a');
		const lease = await createLease(db, contextA, leaseInput(unitId, { startDate: '2024-01-01' }));
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
			description: 'Grundsteuer 2024',
			periodStart: '2024-01-01',
			periodEnd: '2024-12-31',
			// 3.000\u00a0€ against 12 × 200\u00a0€ prepayments: Nachzahlung 600\u00a0€.
			amount: 300000
		});
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
		const [charge] = await chargesOf(db, lease.id);
		expect(charge.amount).toBe(0);
		expect(charge.note).toContain('nicht verlangt');
		const frozen = (await getLeaseResult(db, 'a', first.id, lease.id))!;
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
		const charges = await chargesOf(db, lease.id);
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

describe('createCorrection', () => {
	it('creates a new version whose approval reverses the old charges', async () => {
		const { propertyId, leaseIds, category, key } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
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
		expect(reversal).toMatchObject({ amount: 10567, reversesChargeId: firstCharge.id });
		expect(posted.amount).toBe(3776);
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
		const { propertyId, leaseIds } = await seedScenario(db, 'a');
		const id = await draft(db, propertyId);
		expect(await setDelivered(db, contextA, id, leaseIds.eg, '2026-04-01')).toBe(false);
		await approveStatement(db, contextA, id, { lateApprovalJustified: false, note: null });
		expect(await setDelivered(db, contextA, id, leaseIds.eg, '2026-04-01')).toBe(true);
		const view = (await getStatement(db, 'a', id))!;
		expect(view.leaseResults.find((row) => row.leaseId === leaseIds.eg)).toMatchObject({
			deliveredOn: '2026-04-01',
			objectionDeadline: addMonths('2026-04-01', 12)
		});
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'update'));
		expect(audit[0].summary).toBe(
			'Betriebskostenabrechnung 2025 für EG · Max Müller am 01.04.2026 zugestellt'
		);
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
		expect(await setDelivered(db, contextB, id, leaseIds.eg, '2026-04-01')).toBe(false);
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
			'Dein Anteil'
		]);
		expect(tables[0].rows).toHaveLength(4);
		expect(tables[0].rows[3][1]).toBe(
			'3.000,00\u00a0€\nabzüglich CO2-Anteil Vermieter: 2.880,00\u00a0€'
		);
		expect(tables[0].rows[3][3]).toBe('698,44\u00a0€');
		expect(tables[0].footer).toEqual(['Summe', '', '', '1.185,99\u00a0€']);
		expect(tables[1].title).toBe('Vorauszahlungen');
		expect(tables[1].rows).toHaveLength(6);
		expect(tables[1].rows[0]).toEqual([
			'Januar 2025',
			'120,00\u00a0€',
			'60,00\u00a0€',
			'180,00\u00a0€'
		]);
		expect(tables[1].footer).toEqual(['Vorauszahlungen gesamt', '', '', '1.080,00\u00a0€']);
		const paragraphs = blocks.flatMap((block) => ('paragraph' in block ? [block.paragraph] : []));
		expect(paragraphs[0]).toBe('Guten Tag Frau Alt,');
		expect(paragraphs[1]).toContain('01.01.2025 bis 30.06.2025 (181 von 365 Tagen)');
		expect(paragraphs.find((p) => p.startsWith('CO2-Kostenaufteilung'))).toContain(
			'Vermieteranteil 40 %: vom CO2-Preis 300,00\u00a0€ trägt der Vermieter 120,00\u00a0€'
		);
		expect(paragraphs).toContain(
			'Kosten gesamt 1.185,99\u00a0€, Vorauszahlungen 1.080,00\u00a0€: Nachzahlung 105,99\u00a0€.'
		);
		expect(paragraphs.find((p) => p.startsWith('Bitte überweise'))).toContain(
			`bis zum ${addDays(today(), 30).split('-').reverse().join('.')}`
		);
		expect(letter.closing).toEqual(['Mit freundlichen Grüßen', '', 'Konto A']);
		expect(statementFilename(ogA)).toBe('Betriebskostenabrechnung 2025 OG.pdf');

		const eg = (await getLeaseResult(db, 'a', id, leaseIds.eg)) as LeaseStatement;
		const egParagraphs = statementLetter(eg).blocks!.flatMap((block) =>
			'paragraph' in block ? [block.paragraph] : []
		);
		expect(egParagraphs.find((p) => p.startsWith('Das Guthaben'))).toContain('105,67\u00a0€');
	});
});
