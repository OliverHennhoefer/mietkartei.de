import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { billingPeriods, listDeadlines, type Deadline } from './deadlines';
import type { Database } from './db';
import {
	co2CostSplits,
	depositTransactions,
	meterReadings,
	meters,
	operatingCostStatements,
	rentChanges,
	statementResults,
	units
} from './db/schema';
import { createPolicy } from './insurance';
import { createLease, type LeaseInput } from './leases';
import { contextA, contextB, leaseInput, seedTenant, seedUnit, testDatabase } from './testing';

// Every date below is worked out by hand from the rules in deadlines.ts; the fixed "today" keeps
// the expectations stable.
const TODAY = '2026-10-20';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

async function lease(
	accountId: 'a' | 'b',
	overrides: Partial<LeaseInput> = {},
	unit: { name?: string; propertyName?: string } = {}
) {
	const { unitId, propertyId } = await seedUnit(db, accountId, unit);
	const tenantId = await seedTenant(db, accountId, { firstName: 'Erika', lastName: 'Muster' });
	const context = accountId === 'a' ? contextA : contextB;
	const result = await createLease(
		db,
		context,
		leaseInput(unitId, { tenantIds: [tenantId], ...overrides })
	);
	if (!result.ok) throw new Error(result.reason);
	return { leaseId: result.id, unitId, propertyId };
}

async function list(kind?: Deadline['kind'], filter: { from?: string; to?: string } = {}) {
	const all = await listDeadlines(db, 'a', { ...filter, today: TODAY });
	return kind ? all.filter((deadline) => deadline.kind === kind) : all;
}

const brief = (deadline: Deadline) => [deadline.date, deadline.title, deadline.overdue];

describe('statement deadline (§ 556 Abs. 3 BGB)', () => {
	it('lists one per property and ended year with a residential lease, until a statement is approved', async () => {
		const { propertyId } = await lease('a', { startDate: '2024-01-01' }, { propertyName: 'Haus' });

		// 2024 ended, deadline 31.12.2024 + 12 months = 31.12.2025, passed; 2025: 31.12.2026 ahead.
		// 2026 has not ended, so it has no deadline yet.
		expect((await list('statement')).map(brief)).toEqual([
			['2025-12-31', 'Betriebskostenabrechnung 2024', true],
			['2026-12-31', 'Betriebskostenabrechnung 2025', false]
		]);
		expect((await list('statement'))[0]).toMatchObject({
			href: '/betriebskosten',
			propertyId,
			detail: 'Haus: die Abrechnung muss den Mietern bis zum 31.12.2025 zugehen.'
		});

		await db.insert(operatingCostStatements).values([
			{
				accountId: 'a',
				propertyId,
				periodStart: '2024-01-01',
				periodEnd: '2024-12-31',
				status: 'approved'
			},
			// A draft does not count.
			{ accountId: 'a', propertyId, periodStart: '2025-01-01', periodEnd: '2025-12-31' }
		]);
		expect((await list('statement')).map(brief)).toEqual([
			['2026-12-31', 'Betriebskostenabrechnung 2025', false]
		]);
	});

	it('stays per lease after the approval until the delivery is recorded', async () => {
		const { leaseId, propertyId } = await lease(
			'a',
			{ startDate: '2024-01-01', endDate: '2024-12-31' },
			{ name: 'EG', propertyName: 'Haus' }
		);
		const [first, correction] = await db
			.insert(operatingCostStatements)
			.values([
				{
					accountId: 'a',
					propertyId,
					periodStart: '2024-01-01',
					periodEnd: '2024-12-31',
					status: 'approved'
				},
				{
					accountId: 'a',
					propertyId,
					periodStart: '2024-01-01',
					periodEnd: '2024-12-31',
					version: 2,
					status: 'approved'
				}
			])
			.returning({ id: operatingCostStatements.id });
		const [result] = await db
			.insert(statementResults)
			.values([
				{ accountId: 'a', statementId: first.id, leaseId, balance: 1000, result: '{}' },
				{ accountId: 'a', statementId: correction.id, leaseId, balance: 800, result: '{}' }
			])
			.returning({ id: statementResults.id });

		// Approved but not delivered: the deadline passed on 31.12.2025, still to do.
		const rows = await list('statement');
		expect(rows.map(brief)).toEqual([
			['2025-12-31', 'Betriebskostenabrechnung 2024 zustellen', true]
		]);
		expect(rows[0]).toMatchObject({
			href: `/betriebskosten/abrechnungen/${correction.id}`,
			leaseId,
			propertyId,
			detail:
				'Erika Muster · EG · Haus: die Abrechnung muss bis zum 31.12.2025 zugehen; trag die Zustellung ein.'
		});

		// The delivery of either version settles it.
		await db
			.update(statementResults)
			.set({ deliveredOn: '2025-06-01' })
			.where(eq(statementResults.id, result.id));
		expect(await list('statement')).toEqual([]);
	});

	it('skips commercial leases, years before the ledger start and years after the lease end', async () => {
		await lease('a', { startDate: '2024-01-01', kind: 'commercial' });
		await lease('a', { startDate: '2022-01-01', ledgerStart: '2025-03-01' });
		await lease('a', { startDate: '2023-01-01', endDate: '2023-06-30' });

		expect((await list('statement')).map(brief)).toEqual([
			['2024-12-31', 'Betriebskostenabrechnung 2023', true],
			['2026-12-31', 'Betriebskostenabrechnung 2025', false]
		]);
	});

	it('skips leases with Pauschale or Inklusivmiete for both cost groups, which get no statement', async () => {
		await lease('a', {
			startDate: '2025-01-01',
			operatingCostModel: 'inclusive',
			heatingCostModel: 'flat'
		});
		expect(await list('statement')).toEqual([]);
		// A heating prepayment alone still gets a statement.
		await lease('a', {
			startDate: '2025-01-01',
			operatingCostModel: 'flat',
			heatingCostModel: 'prepayment'
		});
		expect((await list('statement')).map(brief)).toEqual([
			['2026-12-31', 'Betriebskostenabrechnung 2025', false]
		]);
	});

	it('counts the year once however many leases the property has', async () => {
		const { propertyId } = await lease('a', { startDate: '2025-01-01' });
		const second = await seedTenant(db, 'a');
		// A second lease on the same property: seedUnit creates a property per call, so the unit
		// is moved over.
		const { unitId: otherUnit } = await seedUnit(db, 'a');
		await db.update(units).set({ propertyId }).where(eq(units.id, otherUnit));
		await createLease(
			db,
			contextA,
			leaseInput(otherUnit, { tenantIds: [second], startDate: '2025-06-01' })
		);
		expect((await list('statement')).map(brief)).toEqual([
			['2026-12-31', 'Betriebskostenabrechnung 2025', false]
		]);
	});
});

describe('billing periods of the statement deadline', () => {
	const lease = (start: string, end = '9999-12-31') => ({ start, end });

	it('counts calendar years without a statement', () => {
		expect(billingPeriods([], [lease('2024-03-15')], '2026-10-20')).toEqual([
			{ start: '2024-01-01', end: '2024-12-31' },
			{ start: '2025-01-01', end: '2025-12-31' }
		]);
	});

	it('follows the statements and continues their rhythm after the last one', () => {
		const statements = [
			{ periodStart: '2024-01-01', periodEnd: '2024-12-31' },
			{ periodStart: '2025-07-01', periodEnd: '2026-06-30' }
		];
		// Before the first July to June statement, the gap from January to June is a period of its
		// own; after it, the next period runs from July 2026 to June 2027 and has not ended yet.
		expect(billingPeriods(statements, [lease('2024-01-01')], '2026-10-20')).toEqual([
			{ start: '2024-01-01', end: '2024-12-31' },
			{ start: '2025-01-01', end: '2025-06-30' },
			{ start: '2025-07-01', end: '2026-06-30' }
		]);
		expect(billingPeriods(statements, [lease('2024-01-01')], '2027-06-30')).toContainEqual({
			start: '2026-07-01',
			end: '2027-06-30'
		});
	});

	it('keeps the rhythm of a statement from before the leases', () => {
		const statements = [{ periodStart: '2024-07-01', periodEnd: '2025-06-30' }];
		expect(billingPeriods(statements, [lease('2025-07-01')], '2026-10-20')).toEqual([
			{ start: '2025-07-01', end: '2026-06-30' }
		]);
	});

	it('skips periods no lease overlaps', () => {
		expect(
			billingPeriods([], [lease('2022-01-01', '2022-12-31'), lease('2024-06-01')], '2025-01-10')
		).toEqual([
			{ start: '2022-01-01', end: '2022-12-31' },
			{ start: '2024-01-01', end: '2024-12-31' }
		]);
	});
});

describe('statement deadline of a period other than the calendar year', () => {
	it('runs twelve months from the end of the period', async () => {
		const { leaseId, propertyId } = await lease(
			'a',
			{ startDate: '2025-07-01' },
			{ name: 'EG', propertyName: 'Haus' }
		);
		const [statement] = await db
			.insert(operatingCostStatements)
			.values({
				accountId: 'a',
				propertyId,
				periodStart: '2025-07-01',
				periodEnd: '2026-06-30',
				status: 'approved'
			})
			.returning({ id: operatingCostStatements.id });
		await db
			.insert(statementResults)
			.values({ accountId: 'a', statementId: statement.id, leaseId, balance: 0, result: '{}' });
		// § 556 Abs. 3 BGB: the end of June 2026 plus twelve months, not the end of 2026.
		expect((await list('statement')).map(brief)).toEqual([
			['2027-06-30', 'Betriebskostenabrechnung 01.07.2025 – 30.06.2026 zustellen', false]
		]);
	});
});

describe('Mieterhöhung nach § 558', () => {
	it('names the earliest demand, then the consent period and the period to sue', async () => {
		const { leaseId } = await lease('a', { startDate: '2026-01-01' }, { name: 'EG' });
		// Informational: a year after the last change, here the lease start.
		expect((await list('comparative_possible')).map(brief)).toEqual([
			['2027-01-01', 'Mieterhöhung nach § 558 möglich', false]
		]);
		// An index lease has its own row.
		await lease('a', { startDate: '2026-01-01', rentModel: 'indexed' });
		expect(await list('comparative_possible')).toHaveLength(1);

		const values = {
			accountId: 'a',
			leaseId,
			validFrom: '2026-12-01',
			baseRent: 65000,
			reason: 'comparative' as const,
			status: 'proposed' as const
		};
		await db.insert(rentChanges).values({ ...values, deliveredOn: '2026-09-15' });
		expect(await list('comparative_possible')).toEqual([]);
		// Received 15.09.2026: consent by 30.11.2026.
		expect((await list('comparative_consent')).map(brief)).toEqual([
			['2026-11-30', 'Zustimmung zur Mieterhöhung', false]
		]);

		// Received 10.07.2026: the consent period ended on 30.09.2026, suing runs to 31.12.2026.
		await db.delete(rentChanges).where(eq(rentChanges.reason, 'comparative'));
		await db.insert(rentChanges).values({ ...values, deliveredOn: '2026-07-10' });
		const [row] = await list('comparative_consent');
		expect(brief(row)).toEqual(['2026-12-31', 'Klagefrist Mieterhöhung', false]);
		expect(row.detail).toContain('bis zum 30.09.2026 nicht zugestimmt');
	});
});

describe('Einwendungsfrist', () => {
	it('runs to the end of the twelfth month after delivery and disappears once passed', async () => {
		const { leaseId, propertyId } = await lease('a', {}, { name: 'EG', propertyName: 'Haus' });
		const [statement] = await db
			.insert(operatingCostStatements)
			.values({
				accountId: 'a',
				propertyId,
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				status: 'approved'
			})
			.returning({ id: operatingCostStatements.id });
		const [old] = await db
			.insert(operatingCostStatements)
			.values({
				accountId: 'a',
				propertyId,
				periodStart: '2024-01-01',
				periodEnd: '2024-12-31',
				status: 'approved'
			})
			.returning({ id: operatingCostStatements.id });
		await db.insert(statementResults).values([
			{
				accountId: 'a',
				statementId: statement.id,
				leaseId,
				balance: 1000,
				result: '{}',
				deliveredOn: '2026-03-15'
			},
			// Delivered 2025-05-01: the objection period ended 2026-05-31, before today.
			{
				accountId: 'a',
				statementId: old.id,
				leaseId,
				balance: 0,
				result: '{}',
				deliveredOn: '2025-05-01'
			}
		]);

		const rows = await list('objection');
		expect(rows.map(brief)).toEqual([
			// § 556 Abs. 3 Satz 5 BGB: received 15.03.2026, so objections run until 31.03.2027.
			['2027-03-31', 'Einwendungsfrist Betriebskostenabrechnung 2025', false]
		]);
		expect(rows[0]).toMatchObject({
			href: `/betriebskosten/abrechnungen/${statement.id}`,
			leaseId,
			propertyId,
			detail: 'Erika Muster · EG · Haus · zugestellt am 15.03.2026'
		});
	});

	it('needs a delivery date', async () => {
		const { leaseId, propertyId } = await lease('a');
		const [statement] = await db
			.insert(operatingCostStatements)
			.values({
				accountId: 'a',
				propertyId,
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				status: 'approved'
			})
			.returning({ id: operatingCostStatements.id });
		await db
			.insert(statementResults)
			.values({ accountId: 'a', statementId: statement.id, leaseId, balance: 0, result: '{}' });
		expect(await list('objection')).toEqual([]);
	});
});

describe('lease end, deposit return and final meter reading', () => {
	it('lists the end, the deposit settlement six months later and the reading of the unit meters', async () => {
		const { leaseId, unitId, propertyId } = await lease(
			'a',
			{ endDate: '2026-11-30' },
			{ name: 'EG', propertyName: 'Haus' }
		);
		await db.insert(meters).values({
			accountId: 'a',
			propertyId,
			unitId,
			kind: 'cold_water',
			unit: 'm³'
		});

		const rows = (await list()).filter((row) => row.leaseId === leaseId);
		expect(rows.map((row) => [row.kind, row.date, row.overdue])).toEqual([
			// The deposit instalments of January to March 2025 come first, see below.
			['deposit_instalment', '2025-01-06', true],
			['deposit_instalment', '2025-02-05', true],
			['deposit_instalment', '2025-03-05', true],
			['lease_end', '2026-11-30', false],
			['meter_reading', '2026-11-30', false],
			// 30.11.2026 + 6 months = 30.05.2027.
			['deposit_return', '2027-05-30', false]
		]);
		expect(rows.find((row) => row.kind === 'lease_end')).toMatchObject({
			title: 'Vertragsende',
			detail: 'Erika Muster · EG · Haus',
			href: `/vertraege/${leaseId}`,
			propertyId
		});
		expect(rows.find((row) => row.kind === 'deposit_return')).toMatchObject({
			title: 'Kaution abrechnen',
			href: `/vertraege/${leaseId}/kaution`
		});
		expect(rows.find((row) => row.kind === 'meter_reading')).toMatchObject({
			title: 'Zählerstände ablesen',
			href: `/objekte/${propertyId}/zaehler`
		});
	});

	it('keeps the settlement and the reading overdue after the end, until they are done', async () => {
		const { leaseId, unitId, propertyId } = await lease('a', { endDate: '2025-12-31' });
		const [meter] = await db
			.insert(meters)
			.values({ accountId: 'a', propertyId, unitId, kind: 'heat', unit: 'kWh' })
			.returning({ id: meters.id });

		// The end itself has passed and is only informational; 31.12.2025 + 6 months = 30.06.2026.
		expect((await list('lease_end')).map(brief)).toEqual([]);
		expect((await list('deposit_return')).map(brief)).toEqual([
			['2026-06-30', 'Kaution abrechnen', true]
		]);
		expect((await list('meter_reading')).map(brief)).toEqual([
			['2025-12-31', 'Zählerstände ablesen', true]
		]);
		// No instalments are collected on an ended lease.
		expect(await list('deposit_instalment')).toEqual([]);

		// A reading twelve days before the end is not the final reading; one within three days is.
		await db
			.insert(meterReadings)
			.values({ accountId: 'a', meterId: meter.id, readAt: '2025-12-19', value: 100 });
		expect(await list('meter_reading')).toHaveLength(1);
		await db
			.insert(meterReadings)
			.values({ accountId: 'a', meterId: meter.id, readAt: '2026-01-02', value: 120 });
		expect(await list('meter_reading')).toEqual([]);

		// Received in full and returned in full: nothing left to settle.
		await db.insert(depositTransactions).values([
			{ accountId: 'a', leaseId, date: '2025-01-05', amount: 180000, kind: 'received' },
			{ accountId: 'a', leaseId, date: '2026-02-01', amount: -180000, kind: 'returned' }
		]);
		expect(await list('deposit_return')).toEqual([]);
	});

	it('asks only for meters in place at the end, not ones removed before or installed after', async () => {
		const { unitId, propertyId } = await lease('a', { endDate: '2025-12-31' });
		const meter = (installedAt: string | null, removedAt: string | null) => ({
			accountId: 'a',
			propertyId,
			unitId,
			kind: 'cold_water' as const,
			unit: 'm³',
			installedAt,
			removedAt
		});
		const [current] = await db
			.insert(meters)
			.values([
				meter('2020-01-01', null),
				// Exchanged during the lease, and its replacement put in after the tenant left.
				meter(null, '2025-06-30'),
				meter('2026-03-01', null)
			])
			.returning({ id: meters.id });
		expect(await list('meter_reading')).toHaveLength(1);

		await db
			.insert(meterReadings)
			.values({ accountId: 'a', meterId: current.id, readAt: '2025-12-31', value: 50 });
		expect(await list('meter_reading')).toEqual([]);
	});

	it('has no settlement without a deposit and no reading without a meter in the unit', async () => {
		const { propertyId } = await lease('a', { endDate: '2026-11-30', securityDeposit: 0 });
		// A building meter is not read at a tenant change.
		await db.insert(meters).values({ accountId: 'a', propertyId, kind: 'gas', unit: 'm³' });
		expect(await list('deposit_return')).toEqual([]);
		expect(await list('meter_reading')).toEqual([]);
		expect((await list('lease_end')).map(brief)).toEqual([['2026-11-30', 'Vertragsende', false]]);
	});
});

describe('deposit instalments (§ 551 Abs. 2 BGB)', () => {
	it('falls due with the first three rents on the third working day', async () => {
		// January 2025 starts with New Year's Day, a holiday: Thu 2nd, Fri 3rd, Mon 6th. February
		// and March start on a Saturday: Mon 3rd, Tue 4th, Wed 5th.
		const { leaseId } = await lease('a');
		const rows = await list('deposit_instalment');
		expect(rows.map(brief)).toEqual([
			['2025-01-06', 'Kaution: 1. Rate fällig', true],
			['2025-02-05', 'Kaution: 2. Rate fällig', true],
			['2025-03-05', 'Kaution: 3. Rate fällig', true]
		]);
		expect(rows[0]).toMatchObject({ leaseId, href: `/vertraege/${leaseId}/kaution` });
		expect(rows[0].detail).toMatch(/^600,00\s€ von 1\.800,00\s€/);
	});

	it('drops each instalment once the received amount covers it', async () => {
		const { leaseId } = await lease('a');
		const receive = (amount: number) =>
			db
				.insert(depositTransactions)
				.values({ accountId: 'a', leaseId, date: '2025-01-03', amount, kind: 'received' });

		await receive(60000);
		expect((await list('deposit_instalment')).map((row) => row.title)).toEqual([
			'Kaution: 2. Rate fällig',
			'Kaution: 3. Rate fällig'
		]);
		await receive(59999);
		// 119.999 € does not cover the second instalment (120.000 €) yet.
		expect((await list('deposit_instalment')).map((row) => row.title)).toEqual([
			'Kaution: 2. Rate fällig',
			'Kaution: 3. Rate fällig'
		]);
		await receive(1);
		expect((await list('deposit_instalment')).map((row) => row.title)).toEqual([
			'Kaution: 3. Rate fällig'
		]);
		// Interest does not count as received.
		await db
			.insert(depositTransactions)
			.values({ accountId: 'a', leaseId, date: '2026-01-01', amount: 60000, kind: 'interest' });
		expect(await list('deposit_instalment')).toHaveLength(1);
		await receive(60000);
		expect(await list('deposit_instalment')).toEqual([]);
	});

	it('splits an uneven deposit with the cent on the first instalment', async () => {
		// 1.000,00 € / 3 = 333,33 € with 1 cent left, which goes to the first instalment.
		await lease('a', { securityDeposit: 100000 });
		const rows = await list('deposit_instalment');
		expect(rows[0].detail).toMatch(/^333,34\s€ von 1\.000,00\s€/);
		expect(rows[1].detail).toMatch(/^333,33\s€ von 1\.000,00\s€/);
		expect(rows[2].detail).toMatch(/^333,33\s€ von 1\.000,00\s€/);
	});

	it('is never due before the lease starts and respects the due day', async () => {
		// 15.01.2025: the third working day (6.1.) lies before the start, so the start is the date.
		// Due day 1: February 2025 → Mon 3.2., March 2025 → Mon 3.3.
		await lease('a', { startDate: '2025-01-15', rentDueDay: 1 });
		expect((await list('deposit_instalment')).map((row) => row.date)).toEqual([
			'2025-01-15',
			'2025-02-03',
			'2025-03-03'
		]);
	});

	it('applies to residential leases only', async () => {
		await lease('a', { kind: 'commercial' });
		await lease('a', { kind: 'parking', securityDeposit: 10000 });
		expect(await list('deposit_instalment')).toEqual([]);
	});
});

describe('next Staffel step', () => {
	it('names the next approved step that lies ahead', async () => {
		const { leaseId } = await lease('a', { rentModel: 'graduated' });
		const step = (validFrom: string, baseRent: number, status: 'approved' | 'proposed') => ({
			accountId: 'a',
			leaseId,
			validFrom,
			baseRent,
			reason: 'graduated' as const,
			status
		});
		await db
			.insert(rentChanges)
			.values([
				step('2026-01-01', 62000, 'approved'),
				step('2028-01-01', 68000, 'approved'),
				step('2027-01-01', 65000, 'approved'),
				step('2026-12-01', 99000, 'proposed')
			]);

		const rows = await list('graduated_step');
		expect(rows.map(brief)).toEqual([['2027-01-01', 'Nächste Mietstaffel', false]]);
		expect(rows[0]).toMatchObject({ href: `/vertraege/${leaseId}/miethoehe`, leaseId });
		expect(rows[0].detail).toMatch(/^Kaltmiete 650,00\s€ ab 01\.01\.2027/);
	});

	it('shows nothing without a step ahead', async () => {
		const { leaseId } = await lease('a', { rentModel: 'graduated' });
		await db.insert(rentChanges).values({
			accountId: 'a',
			leaseId,
			validFrom: '2026-01-01',
			baseRent: 62000,
			reason: 'graduated'
		});
		expect(await list('graduated_step')).toEqual([]);
	});
});

describe('earliest index proposal (§ 557b Abs. 2 BGB)', () => {
	it('is two months before the end of the twelve months after the last change of the base rent, ignoring § 560 changes', async () => {
		const { leaseId } = await lease('a', { rentModel: 'indexed', indexBaseValue: 120 });
		// Only the initial rent from 01.01.2025: the waiting period ended 01.01.2026, so nothing to
		// know about any more.
		expect(await list('index_proposal')).toEqual([]);

		await db.insert(rentChanges).values([
			// A prepayment adjustment after a statement: not a change of the base rent.
			{
				accountId: 'a',
				leaseId,
				validFrom: '2026-02-01',
				baseRent: 60000,
				operatingCostPrepayment: 17000,
				reason: 'statement'
			},
			{ accountId: 'a', leaseId, validFrom: '2026-04-01', baseRent: 62000, reason: 'indexed' },
			// A manual change of the prepayment only, after the index change.
			{
				accountId: 'a',
				leaseId,
				validFrom: '2026-06-01',
				baseRent: 62000,
				heatingCostPrepayment: 6000,
				reason: 'manual'
			}
		]);
		// The waiting period ends 01.04.2027; a proposal sent in February 2027 takes effect on
		// 01.04.2027 (§ 557b Abs. 3 BGB: the month after next), so the row is dated 01.02.2027.
		const rows = await list('index_proposal');
		expect(rows.map(brief)).toEqual([['2027-02-01', 'Indexanpassung frühestens möglich', false]]);
		expect(rows[0]).toMatchObject({ href: `/vertraege/${leaseId}/miethoehe` });
		expect(rows[0].detail).toMatch(
			/^Erhöhung kann ab 01\.02\.2027 verlangt werden und frühestens ab 01\.04\.2027 gelten; letzte Änderung der Kaltmiete am 01\.04\.2026/
		);
	});

	it('dates a waiting period ending mid-month on the first of the month before', async () => {
		const { leaseId } = await lease('a', { rentModel: 'indexed', indexBaseValue: 120 });
		await db.insert(rentChanges).values({
			accountId: 'a',
			leaseId,
			validFrom: '2026-04-15',
			baseRent: 62000,
			reason: 'manual'
		});
		// Waiting period until 15.04.2027: a proposal in February takes effect on 01.04.2027, too
		// early; one in March takes effect on 01.05.2027. So 01.03.2027.
		expect((await list('index_proposal')).map(brief)).toEqual([
			['2027-03-01', 'Indexanpassung frühestens möglich', false]
		]);
	});

	it('applies to residential indexed leases only', async () => {
		await lease('a', { rentModel: 'indexed', kind: 'commercial', startDate: '2026-01-01' });
		await lease('a', { rentModel: 'fixed', startDate: '2026-01-01' });
		expect(await list('index_proposal')).toEqual([]);
	});
});

describe('CO₂ reimbursement', () => {
	it('is twelve months after the claim', async () => {
		const { leaseId } = await lease('a');
		const split = (year: number, claimedOn: string) => ({
			accountId: 'a',
			leaseId,
			year,
			fuel: 'gas' as const,
			co2Kg: 1000,
			co2Cost: 15000,
			area: 64,
			landlordPercent: 30,
			amount: 4500,
			claimedOn
		});
		await db.insert(co2CostSplits).values([
			split(2025, '2026-02-10'),
			// Claimed 2025-01-01: the year to settle ended 2026-01-01, before today.
			split(2024, '2025-01-01')
		]);
		const rows = await list('co2_reimbursement');
		expect(rows.map(brief)).toEqual([['2027-02-10', 'CO₂-Kostenanteil 2025 erstatten', false]]);
		expect(rows[0]).toMatchObject({ href: `/vertraege/${leaseId}/co2`, leaseId });
		expect(rows[0].detail).toMatch(/^45,00\s€ · /);
	});
});

describe('Versicherungen', () => {
	const policy = {
		kind: 'building' as const,
		insurer: 'Allianz',
		policyNumber: null,
		annualPremium: 1200_00,
		renewalDate: '2020-01-01',
		noticeMonths: 3,
		endDate: null,
		note: null
	};

	it('names the last day to cancel before the next renewal still open', async () => {
		const { propertyId } = await seedUnit(db, 'a', { propertyName: 'Haus' });
		// 2027-01-01's deadline (30.09.2026) has passed on TODAY, so the row is for 2028.
		const created = await createPolicy(db, contextA, propertyId, policy);
		if (!created.ok) throw new Error('create');
		expect(await list()).toEqual([
			{
				kind: 'insurance_notice',
				date: '2027-09-30',
				title: 'Kündigungsfrist Wohngebäudeversicherung',
				detail: 'Allianz · Haus: kündbar zum 31.12.2027, sonst verlängert sie sich um ein Jahr.',
				href: `/objekte/${propertyId}/versicherungen/${created.id}`,
				propertyId,
				overdue: false
			}
		]);
	});

	it('shows the end of cover of a cancelled policy until it has passed', async () => {
		const { propertyId } = await seedUnit(db, 'a', { propertyName: 'Haus' });
		await createPolicy(db, contextA, propertyId, { ...policy, endDate: '2026-12-31' });
		await createPolicy(db, contextA, propertyId, { ...policy, endDate: '2026-01-31' });
		expect((await list()).map((row) => [row.kind, row.date, row.title])).toEqual([
			['insurance_end', '2026-12-31', 'Wohngebäudeversicherung endet']
		]);
	});
});

describe('listDeadlines', () => {
	it('sorts by date, keeps overdue rows whatever `from` says and cuts at `to`', async () => {
		await lease('a', { endDate: '2027-03-31' });
		const all = await list();
		const dates = all.map((row) => row.date);
		expect(dates).toEqual([...dates].sort());
		expect(all.map((row) => row.kind)).toEqual([
			'deposit_instalment',
			'deposit_instalment',
			'deposit_instalment',
			'statement',
			'lease_end',
			'deposit_return'
		]);

		const window = await list(undefined, { from: '2026-12-01', to: '2027-06-30' });
		expect(window.map((row) => [row.kind, row.date])).toEqual([
			['deposit_instalment', '2025-01-06'],
			['deposit_instalment', '2025-02-05'],
			['deposit_instalment', '2025-03-05'],
			['statement', '2026-12-31'],
			['lease_end', '2027-03-31']
			// The deposit return on 30.09.2027 lies after `to`.
		]);
	});

	it('does not leak into another account', async () => {
		await lease('b', { endDate: '2026-12-31' });
		expect(await list()).toEqual([]);
		expect((await listDeadlines(db, 'b', { today: TODAY })).length).toBeGreaterThan(0);
	});
});
