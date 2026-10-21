import { describe, expect, it } from 'vitest';
import type { Meter, Reading } from './consumption';
import {
	balanceLabel,
	computeStatement,
	leaseLabel,
	objectionDeadline,
	periodLabel,
	personsOn,
	statementDeadline,
	suggestedPrepayments,
	validatePeriod,
	type LeaseStatement,
	type LedgerCharge,
	type LedgerPayment,
	type StatementInput,
	type StatementItem,
	type StatementKey,
	type StatementLease
} from './statement';

// The reference scenario: Lindenstraße 4 (residential, vacancyPersons 1) with three units and the
// year 2025. Every lease pays its rent of 600 € plus prepayments in full each month.
//
//   EG  72,5 m², lease all year, 2 persons, prepayments 150 + 50 € (ledger from February, so
//       January's prepayment comes from the rent history: 11 paid months + 1 from history)
//   OG  64 m², tenant change on 30 June: lease A (2 persons, 120 + 60 €) until 30 June, lease B
//       (1 person, 100 + 50 €) from 1 July; the heat meter was read on 30 June
//   DG  48 m², lease (1 person, 80 + 40 €) until 31 August, vacant from 1 September, no reading
//       at the change
//
// Cost items: Grundsteuer 1.200 € (area), Müll 600 € (persons), Hausmeister 900 € (units),
// Heizung 3.000 € (mixed 70/30 on heat meters EG 1.000 kWh, OG 600 + 400 kWh, DG 200 kWh),
// Verwaltung 500 € (not allocable).

const period = { start: '2025-01-01', end: '2025-12-31' };

const reading = (readAt: string, value: number, estimated = false): Reading => ({
	readAt,
	value,
	estimated
});

const meter = (id: string, unitId: string, readings: Reading[], overrides: Partial<Meter> = {}) =>
	({
		id,
		unitId,
		kind: 'heat',
		unit: 'kWh',
		installedAt: null,
		removedAt: null,
		readings,
		...overrides
	}) as Meter;

/** `rent` charges for the months, 600 € base rent and the same prepayments every month. */
function charges(months: string[], operating: number, heating: number): LedgerCharge[] {
	return months.map((period) => ({
		kind: 'rent',
		period,
		dueDate: `${period}-03`,
		amount: 60000 + operating + heating,
		operatingCostPrepayment: operating,
		heatingCostPrepayment: heating
	}));
}

/** Pays every charge in full on the 5th of its month. */
function paidInFull(rows: LedgerCharge[]): LedgerPayment[] {
	return rows.map((charge) => ({ date: `${charge.period}-05`, amount: charge.amount }));
}

const months = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, i) => `2025-${String(from + i).padStart(2, '0')}`);

function lease(
	id: string,
	unitIds: string[],
	range: { start: string; end: string | null },
	persons: number,
	prepayments: { operating: number; heating: number; months: string[] },
	tenant: { salutation: string; firstName: string; lastName: string },
	overrides: Partial<StatementLease> = {}
): StatementLease {
	return {
		id,
		kind: 'residential',
		startDate: range.start,
		endDate: range.end,
		operatingCostModel: 'prepayment',
		heatingCostModel: 'prepayment',
		ledgerStart: null,
		unitIds,
		tenants: [{ ...tenant, street: null, postalCode: null, city: null }],
		persons: [{ validFrom: range.start, persons }],
		rentHistory: [
			{
				validFrom: range.start,
				baseRent: 60000,
				operatingCostPrepayment: prepayments.operating,
				heatingCostPrepayment: prepayments.heating,
				status: 'approved'
			}
		],
		charges: charges(prepayments.months, prepayments.operating, prepayments.heating),
		payments: paidInFull(charges(prepayments.months, prepayments.operating, prepayments.heating)),
		...overrides
	};
}

function item(
	id: string,
	description: string,
	categoryId: string,
	allocationKeyId: string,
	amount: number,
	overrides: Partial<StatementItem> = {}
): StatementItem {
	return {
		id,
		description,
		supplier: null,
		categoryId,
		allocationKeyId,
		billingCircleId: null,
		periodStart: '2025-01-01',
		periodEnd: '2025-12-31',
		amount,
		allocable: true,
		unitAmounts: [],
		...overrides
	};
}

const key = (
	id: string,
	name: string,
	kind: StatementKey['kind'],
	extra: Partial<StatementKey> = {}
) =>
	({
		id,
		name,
		kind,
		meterKind: null,
		consumptionPercent: null,
		shares: [],
		...extra
	}) as StatementKey;

function scenario(): StatementInput {
	return {
		property: {
			id: 'p',
			name: 'Lindenstraße 4',
			street: 'Lindenstraße 4',
			postalCode: '10115',
			city: 'Berlin',
			vacancyPersons: 1
		},
		period,
		units: [
			{ id: 'eg', name: 'EG', kind: 'apartment', floorArea: 72.5 },
			{ id: 'og', name: 'OG', kind: 'apartment', floorArea: 64 },
			{ id: 'dg', name: 'DG', kind: 'apartment', floorArea: 48 }
		],
		leases: [
			lease(
				'l-eg',
				['eg'],
				{ start: '2024-06-01', end: null },
				2,
				{ operating: 15000, heating: 5000, months: months(2, 12) },
				{ salutation: 'Herr', firstName: 'Max', lastName: 'Müller' },
				{ ledgerStart: '2025-02-01' }
			),
			lease(
				'l-og-a',
				['og'],
				{ start: '2023-01-01', end: '2025-06-30' },
				2,
				{ operating: 12000, heating: 6000, months: months(1, 6) },
				{ salutation: 'Frau', firstName: 'Anna', lastName: 'Alt' }
			),
			lease(
				'l-og-b',
				['og'],
				{ start: '2025-07-01', end: null },
				1,
				{ operating: 10000, heating: 5000, months: months(7, 12) },
				{ salutation: 'Herr', firstName: 'Bernd', lastName: 'Neu' }
			),
			lease(
				'l-dg',
				['dg'],
				{ start: '2022-01-01', end: '2025-08-31' },
				1,
				{ operating: 8000, heating: 4000, months: months(1, 8) },
				{ salutation: 'Frau', firstName: 'Dora', lastName: 'Dach' }
			)
		],
		items: [
			item('i-grundsteuer', 'Grundsteuer 2025', 'c-grundsteuer', 'k-area', 120000),
			item('i-muell', 'Müllabfuhr', 'c-muell', 'k-persons', 60000),
			item('i-hausmeister', 'Hausmeister', 'c-hausmeister', 'k-units', 90000),
			item('i-heizung', 'Gasrechnung', 'c-heizung', 'k-heat', 300000),
			item('i-verwaltung', 'Hausverwaltung', 'c-verwaltung', 'k-units', 50000)
		],
		categories: [
			{
				id: 'c-grundsteuer',
				name: 'Grundsteuer',
				betrkvItem: 1,
				allocable: true,
				consumptionBased: false
			},
			{
				id: 'c-muell',
				name: 'Müllbeseitigung',
				betrkvItem: 8,
				allocable: true,
				consumptionBased: false
			},
			{
				id: 'c-hausmeister',
				name: 'Hauswart',
				betrkvItem: 14,
				allocable: true,
				consumptionBased: false
			},
			{ id: 'c-heizung', name: 'Heizung', betrkvItem: 4, allocable: true, consumptionBased: true },
			{
				id: 'c-verwaltung',
				name: 'Verwaltungskosten (nicht umlagefähig)',
				betrkvItem: null,
				allocable: false,
				consumptionBased: false
			}
		],
		keys: [
			key('k-area', 'Wohnfläche', 'area'),
			key('k-persons', 'Personen', 'persons'),
			key('k-units', 'Einheiten', 'units'),
			key('k-heat', 'Heizung 70/30', 'mixed', { meterKind: 'heat', consumptionPercent: 70 })
		],
		circles: [],
		meters: [
			meter('m-eg', 'eg', [reading('2025-01-01', 0), reading('2025-12-31', 1000)]),
			meter('m-og', 'og', [
				reading('2025-01-01', 0),
				reading('2025-06-30', 600),
				reading('2025-12-31', 1000)
			]),
			meter('m-dg', 'dg', [reading('2025-01-01', 0), reading('2025-12-31', 200)])
		],
		landlord: {
			name: 'Erika Vermieter',
			street: 'Musterstraße 1',
			postalCode: '10115',
			city: 'Berlin',
			iban: 'DE02120300000000202051',
			bankName: 'DKB'
		}
	};
}

const options = { today: '2026-03-15' };

function lineAmounts(statement: LeaseStatement): Record<string, number> {
	return Object.fromEntries(statement.lines.map((line) => [line.categoryName, line.amount]));
}

describe('computeStatement with the reference scenario', () => {
	const result = computeStatement(scenario(), options);
	const byLease = Object.fromEntries(result.leases.map((lease) => [lease.leaseId, lease]));

	it('derives the property totals', () => {
		// Costs 1.200 + 600 + 900 + 3.000 + 500 = 6.200 €; Verwaltung is not allocable.
		expect(result.property.costsTotal).toBe(620000);
		expect(result.property.allocableTotal).toBe(570000);
		expect(result.property.nonAllocableTotal).toBe(50000);
		expect(result.property.leaseCount).toBe(4);
		expect(result.property.deadline).toBe('2026-12-31');
		expect(result.property.late).toBe(false);
		// Only the DG change without a Zwischenablesung is reported.
		expect(result.property.warnings.map((warning) => warning.code)).toEqual(['no_interim_reading']);
		expect(result.property.warnings[0]).toMatchObject({
			blocking: false,
			unitId: 'dg',
			href: '/objekte/p/zaehler?meter=m-dg'
		});
	});

	it('allocates the EG share: area, persons, units and the 70/30 heating split', () => {
		const eg = byLease['l-eg'];
		expect(eg.occupancy).toEqual({ start: '2025-01-01', end: '2025-12-31', days: 365 });
		expect(eg.persons).toEqual([{ from: '2025-01-01', to: '2025-12-31', persons: 2 }]);
		expect(lineAmounts(eg)).toEqual({
			// Grundsteuer 1.200 € × 72,5 / 184,5 m² = 471,544… → 471,54 € (largest remainder goes to DG).
			Grundsteuer: 47154,
			// Person-days: EG 2 × 365 = 730, OG 2 × 181 + 1 × 184 = 546, DG 1 × 243 + vacancy 1 × 122 = 365,
			// total 1.641; Müll 600 € × 730 / 1.641 = 266,910… → 266,91 €.
			Müllbeseitigung: 26691,
			// Hausmeister 900 € / 3 units = 300 €.
			Hauswart: 30000,
			// Heizung: 70 % = 2.100 € by consumption (EG 1.000 of 2.200 kWh → 954,545… → 954,55 € with
			// the remainder), 30 % = 900 € by area (72,5 / 184,5 → 353,658… → 353,66 €): 1.308,21 €.
			Heizung: 130821
		});
		const heating = eg.lines.find((line) => line.categoryName === 'Heizung')!;
		expect(heating).toMatchObject({
			heating: true,
			itemTotal: 300000,
			keyName: 'Heizung 70/30',
			keyKind: 'mixed',
			keyTotal: '70 % nach Verbrauch: 2.200 kWh · 30 % nach Fläche: 184,5 m²'
		});
		expect(heating.share).toBe(
			'70 % nach Verbrauch: 1.000 von 2.200 kWh · 30 % nach Fläche: 72,5 m² von 184,5 m² · 365 von 365 Tagen'
		);
		expect(eg.lines.find((line) => line.categoryName === 'Grundsteuer')).toMatchObject({
			keyTotal: '184,5 m²',
			share: '72,5 m² von 184,5 m² · 365 von 365 Tagen',
			betrkvItem: 1
		});
		expect(eg.lines.find((line) => line.categoryName === 'Müllbeseitigung')).toMatchObject({
			keyTotal: '1.641 Personentage',
			share: '730 von 1.641 Personentagen'
		});
		// 471,54 + 266,91 + 300,00 + 1.308,21 = 2.346,66 €.
		expect(eg.costsTotal).toBe(234666);
		// Prepayments: 11 paid months (February to December) plus January from the rent history,
		// each 150 + 50 € = 200 €: 2.400 €.
		expect(eg.prepayments).toHaveLength(12);
		expect(eg.prepayments[0]).toEqual({
			period: '2025-01',
			charged: 20000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			amount: 20000,
			source: 'history'
		});
		expect(eg.prepayments[1]).toMatchObject({ source: 'ledger', charged: 20000, amount: 20000 });
		expect(eg.prepaymentsTotal).toBe(240000);
		expect(eg.unpaidPrepayments).toBe(0);
		// 2.346,66 − 2.400,00 = −53,34 € Guthaben.
		expect(eg.balance).toBe(-5334);
		expect(balanceLabel(eg.balance)).toBe('Guthaben');
		expect(eg.excluded).toEqual([]);
		expect(eg.warnings).toEqual([]);
		expect(eg.deadline).toBe('2026-12-31');
	});

	it('splits the OG unit between lease A and B by the interim reading and by days', () => {
		const a = byLease['l-og-a'];
		const b = byLease['l-og-b'];
		expect(a.occupancy).toEqual({ start: '2025-01-01', end: '2025-06-30', days: 181 });
		expect(b.occupancy).toEqual({ start: '2025-07-01', end: '2025-12-31', days: 184 });
		expect(lineAmounts(a)).toEqual({
			// OG Grundsteuer 1.200 € × 64 / 184,5 = 416,26 €; A 181 / 365 days = 206,418… → 206,42 €.
			Grundsteuer: 20642,
			// OG Müll 600 € × 546 / 1.641 = 199,63 €; A 362 of 546 person-days = 132,355… → 132,36 €.
			Müllbeseitigung: 13236,
			// OG Hausmeister 300 €; A 181 / 365 = 148,767… → 148,77 €.
			Hauswart: 14877,
			// OG heating: consumption 2.100 € × 1.000 / 2.200 = 954,54 €, A 600 of 1.000 kWh by the
			// reading of 30 June = 572,724 → 572,72 €; area 900 € × 64 / 184,5 = 312,19 €, A 181 / 365
			// days = 154,812… → 154,81 €: 727,53 €.
			Heizung: 72753
		});
		expect(lineAmounts(b)).toEqual({
			// 416,26 − 206,42
			Grundsteuer: 20984,
			// 199,63 − 132,36
			Müllbeseitigung: 6727,
			// 300,00 − 148,77
			Hauswart: 15123,
			// 954,54 − 572,72 = 381,82 and 312,19 − 154,81 = 157,38
			Heizung: 53920
		});
		const heatingA = a.lines.find((line) => line.categoryName === 'Heizung')!;
		expect(heatingA.method).toBe('readings');
		expect(heatingA.share).toContain('davon 600 kWh laut Zwischenablesung');
		expect(heatingA.share).toContain('181 von 365 Tagen');
		expect(a.lines.find((line) => line.categoryName === 'Müllbeseitigung')?.share).toBe(
			'546 von 1.641 Personentagen · davon 362 Personentage'
		);
		// A: 206,42 + 132,36 + 148,77 + 727,53 = 1.215,08 €; prepayments 6 × 180 € = 1.080 €.
		expect(a.costsTotal).toBe(121508);
		expect(a.prepaymentsTotal).toBe(108000);
		expect(a.balance).toBe(13508);
		// B: 209,84 + 67,27 + 151,23 + 539,20 = 967,54 €; prepayments 6 × 150 € = 900 €.
		expect(b.costsTotal).toBe(96754);
		expect(b.prepaymentsTotal).toBe(90000);
		expect(b.balance).toBe(6754);
	});

	it('splits the DG unit between the lease and the vacancy by Gradtagszahlen', () => {
		const dg = byLease['l-dg'];
		expect(dg.occupancy.days).toBe(243);
		expect(lineAmounts(dg)).toEqual({
			// DG Grundsteuer 312,20 €; 243 / 365 days = 207,848… → 207,85 €.
			Grundsteuer: 20785,
			// DG Müll 133,46 €; 243 of 365 person-days = 88,851… → 88,85 € (vacancy 44,61 €).
			Müllbeseitigung: 8885,
			// DG Hausmeister 300 €; 243 / 365 = 199,726… → 199,73 €.
			Hauswart: 19973,
			// DG heating: consumption 2.100 € × 200 / 2.200 = 190,91 €, no reading on 31 August, so
			// Gradtagszahlen January–August 610 of 1.000: 116,455… → 116,46 €; area 900 € × 48 / 184,5
			// = 234,15 €, 243 / 365 days = 155,886… → 155,89 €: 272,35 €.
			Heizung: 27235
		});
		const heating = dg.lines.find((line) => line.categoryName === 'Heizung')!;
		expect(heating.method).toBe('degree_days');
		expect(heating.share).toContain('davon 61 % nach Gradtagszahlen');
		// 207,85 + 88,85 + 199,73 + 272,35 = 768,78 €; prepayments 8 × 120 € = 960 €.
		expect(dg.costsTotal).toBe(76878);
		expect(dg.prepaymentsTotal).toBe(96000);
		expect(dg.balance).toBe(-19122);
		expect(dg.warnings.map((warning) => warning.code)).toEqual(['no_interim_reading']);
		// The vacancy: 104,35 + 44,61 + 100,27 + 74,45 + 78,26 = 401,94 € stay with the landlord.
		expect(result.property.vacancyShare).toBe(40194);
		expect(result.property.items.find((i) => i.itemId === 'i-muell')?.vacancyShare).toBe(4461);
	});

	it('adds up: every allocated cent lands on a lease or the vacancy', () => {
		const leaseSum = result.leases.reduce((sum, lease) => sum + lease.costsTotal, 0);
		// 2.346,66 + 1.215,08 + 967,54 + 768,78 + 401,94 = 5.700,00 €.
		expect(leaseSum + result.property.vacancyShare).toBe(570000);
		expect(result.property.nachzahlungen).toBe(13508 + 6754);
		expect(result.property.guthaben).toBe(5334 + 19122);
		expect(result.property.excludedTotal).toBe(0);
		expect(result.property.unallocatedTotal).toBe(0);
		expect(result.property.leases.map((lease) => lease.label)).toEqual([
			'DG · Dora Dach',
			'OG · Anna Alt',
			'EG · Max Müller',
			'OG · Bernd Neu'
		]);
	});

	it('leaves the approval fields empty', () => {
		expect(result.property.approvedOn).toBeNull();
		for (const lease of result.leases) {
			expect(lease.landlord.name).toBe('Erika Vermieter');
			expect(lease.property.name).toBe('Lindenstraße 4');
			expect(lease.approvedOn).toBeNull();
			expect(lease.dueDate).toBeNull();
			expect(lease.posted).toBeNull();
		}
	});

	it('is deterministic', () => {
		expect(computeStatement(scenario(), options)).toEqual(result);
	});
});

describe('computeStatement prepayments', () => {
	// EG alone, rent account from January: 600 + 150 + 50 € charged each month of 2025.
	function eg(payments: LedgerPayment[], extra: LedgerCharge[] = []): LeaseStatement {
		const input = scenario();
		input.leases[0] = {
			...input.leases[0],
			ledgerStart: null,
			startDate: '2025-01-01',
			charges: [...charges(months(1, 12), 15000, 5000), ...extra],
			payments
		};
		return computeStatement(input, options).leases.find((lease) => lease.leaseId === 'l-eg')!;
	}
	const pay = (date: string, amount: number): LedgerPayment => ({ date, amount });
	const elevenMonths = months(1, 11).map((month) => pay(`${month}-05`, 80000));

	it('credits only the prepayments that were paid', () => {
		// December unpaid: 11 × 200 € = 2.200 € paid, the 200 € of December are open.
		const unpaid = eg(elevenMonths);
		expect(unpaid.prepayments[11]).toEqual({
			period: '2025-12',
			charged: 20000,
			operatingCostPrepayment: 0,
			heatingCostPrepayment: 0,
			amount: 0,
			source: 'ledger'
		});
		expect(unpaid.prepaymentsTotal).toBe(220000);
		expect(unpaid.unpaidPrepayments).toBe(20000);
		// 2.346,66 − 2.200,00 = 146,66 € Nachzahlung instead of a Guthaben of 53,34 €.
		expect(unpaid.balance).toBe(14666);
	});

	it('takes a partial payment of a month for its prepayments first', () => {
		// 500 € of December's 800 €: the 200 € of prepayments are paid, 300 € of the rent are not.
		const mostly = eg([...elevenMonths, pay('2025-12-05', 50000)]);
		expect(mostly.prepayments[11]).toMatchObject({ amount: 20000, operatingCostPrepayment: 15000 });
		expect(mostly.unpaidPrepayments).toBe(0);
		// 100 € of December's 800 €: half of the prepayments, split 3 : 1 like 150 : 50 €.
		const little = eg([...elevenMonths, pay('2025-12-05', 10000)]);
		expect(little.prepayments[11]).toMatchObject({
			charged: 20000,
			operatingCostPrepayment: 7500,
			heatingCostPrepayment: 2500,
			amount: 10000
		});
		expect(little.prepaymentsTotal).toBe(230000);
		expect(little.unpaidPrepayments).toBe(10000);
	});

	it('settles the oldest charges first, with due credits but without later payments', () => {
		// No payment in March: the eleven payments cover January to November, so it is December
		// that stays open, as on the rent account.
		const noMarch = months(1, 12)
			.filter((month) => month !== '2025-03')
			.map((month) => pay(`${month}-05`, 80000));
		const statement = eg(noMarch);
		expect(statement.prepayments.map((month) => month.amount)).toEqual([
			...Array(11).fill(20000),
			0
		]);
		// A Guthaben of the year before (due) settles 200 € more; a payment after today does not.
		const credit: LedgerCharge = {
			kind: 'statement_balance',
			period: '2024-12',
			dueDate: '2025-04-15',
			amount: -20000,
			operatingCostPrepayment: 0,
			heatingCostPrepayment: 0
		};
		expect(eg([...noMarch, pay('2026-03-20', 60000)], [credit]).prepaymentsTotal).toBe(240000);
		expect(eg([...noMarch, pay('2026-03-20', 60000)]).prepaymentsTotal).toBe(220000);
		// A Nachzahlung of 700 € due on 02.01.2025 is settled before the months of 2025, so only
		// 100 € are left for December; one that is not due yet comes last.
		const twelveMonths = [...elevenMonths, pay('2025-12-05', 80000)];
		const due = { ...credit, dueDate: '2025-01-02', amount: 70000 };
		expect(eg(twelveMonths, [due]).prepayments[11].amount).toBe(10000);
		expect(eg(twelveMonths, [{ ...due, dueDate: null }]).prepaymentsTotal).toBe(240000);
	});

	it('credits an ended lease only what it paid', () => {
		// DG ran until 31 August and paid six of its eight months: 6 × 120 € instead of 8 × 120 €.
		const input = scenario();
		const dg = input.leases.find((lease) => lease.id === 'l-dg')!;
		dg.payments = dg.payments.slice(0, 6);
		const statement = computeStatement(input, options).leases.find((l) => l.leaseId === 'l-dg')!;
		expect(statement.prepaymentsTotal).toBe(72000);
		expect(statement.unpaidPrepayments).toBe(24000);
		// 768,78 − 720,00 = 48,78 € Nachzahlung.
		expect(statement.balance).toBe(4878);
	});

	it('counts no Pauschale as a prepayment', () => {
		const input = scenario();
		input.leases[0].heatingCostModel = 'flat';
		const statement = computeStatement(input, options).leases.find((l) => l.leaseId === 'l-eg')!;
		expect(statement.prepayments[5]).toMatchObject({
			charged: 15000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 0
		});
	});
});

describe('computeStatement warnings', () => {
	function small(overrides: Partial<StatementInput> = {}): StatementInput {
		const base = scenario();
		return {
			...base,
			units: [
				{ id: 'eg', name: 'EG', kind: 'apartment', floorArea: 60 },
				{ id: 'og', name: 'OG', kind: 'apartment', floorArea: 40 }
			],
			leases: [
				lease(
					'l-eg',
					['eg'],
					{ start: '2025-01-01', end: null },
					2,
					{ operating: 10000, heating: 5000, months: months(1, 12) },
					{ salutation: 'Herr', firstName: 'Max', lastName: 'Müller' }
				),
				lease(
					'l-og',
					['og'],
					{ start: '2025-01-01', end: null },
					1,
					{ operating: 10000, heating: 5000, months: months(1, 12) },
					{ salutation: 'Frau', firstName: 'Anna', lastName: 'Alt' }
				)
			],
			items: [item('i-grundsteuer', 'Grundsteuer', 'c-grundsteuer', 'k-area', 100000)],
			meters: [
				meter('m-eg', 'eg', [reading('2025-01-01', 0), reading('2025-12-31', 600)]),
				meter('m-og', 'og', [reading('2025-01-01', 0), reading('2025-12-31', 400)])
			],
			...overrides
		};
	}

	it('warns about a missing floor area and gives that unit no area share', () => {
		const input = small();
		input.units[1].floorArea = null;
		const result = computeStatement(input, options);
		expect(result.property.warnings).toEqual([
			{
				code: 'missing_area',
				blocking: false,
				unitId: 'og',
				href: '/objekte/p/einheiten/og/bearbeiten',
				message: 'Für die Einheit OG fehlt die Wohnfläche; sie erhält keinen Anteil nach Fläche.'
			}
		]);
		// EG carries the whole 1.000 €, OG nothing.
		expect(result.leases.find((l) => l.leaseId === 'l-eg')?.costsTotal).toBe(100000);
		expect(result.leases.find((l) => l.leaseId === 'l-og')?.costsTotal).toBe(0);
	});

	it('blocks approval while a reading is missing and clears it with an estimate', () => {
		const heat = (meters: Meter[]) =>
			small({
				items: [item('i-heizung', 'Fernwärme', 'c-heizung', 'k-consumption', 100000)],
				keys: [key('k-consumption', 'Wärme', 'consumption', { meterKind: 'heat' })],
				meters
			});
		const missing = computeStatement(
			heat([
				meter('m-eg', 'eg', [reading('2025-01-01', 0)]),
				meter('m-og', 'og', [reading('2025-01-01', 0), reading('2025-12-31', 400)])
			]),
			options
		);
		expect(missing.property.warnings).toMatchObject([
			{
				code: 'missing_reading',
				blocking: true,
				unitId: 'eg',
				meterId: 'm-eg',
				href: '/objekte/p/zaehler?meter=m-eg'
			}
		]);
		// Without a value EG weighs 0, so OG carries everything for now.
		expect(missing.leases.find((l) => l.leaseId === 'l-og')?.costsTotal).toBe(100000);

		const estimated = computeStatement(
			heat([
				meter('m-eg', 'eg', [reading('2025-01-01', 0), reading('2025-12-31', 900, true)]),
				meter('m-og', 'og', [reading('2025-01-01', 0), reading('2025-12-31', 400)])
			]),
			options
		);
		// § 9a HeizKV: the estimate is reported, not blocking. EG's estimate covers 60 of 100 m²,
		// more than 25 % of the area, so § 9a Abs. 2 splits the cost by area alone: EG 60 % =
		// 600 € instead of 900 / 1.300 kWh = 692,31 € by the estimated consumption.
		expect(estimated.property.warnings.map((w) => [w.code, w.blocking])).toEqual([
			['estimated_reading', false],
			['estimated_share', false]
		]);
		expect(estimated.property.warnings[1].message).toContain('nur nach Fläche verteilt');
		const eg = estimated.leases.find((l) => l.leaseId === 'l-eg')!;
		expect(eg.costsTotal).toBe(60000);
		expect(eg.lines[0].share).toBe(
			'nach Fläche statt Verbrauch (§ 9a Abs. 2 HeizKV): 60 m² von 100 m² · 365 von 365 Tagen'
		);
		expect(eg.lines[0].keyTotal).toBe('nach Fläche statt Verbrauch (§ 9a Abs. 2 HeizKV): 100 m²');

		// Estimates on 40 of 100 m² (OG) under a 70/30 key: the 70 % part moves to the area too.
		const mixed = computeStatement(
			small({
				items: [item('i-heizung', 'Fernwärme', 'c-heizung', 'k-mixed', 100000)],
				keys: [
					key('k-mixed', 'Heizung 70/30', 'mixed', { meterKind: 'heat', consumptionPercent: 70 })
				],
				meters: [
					meter('m-eg', 'eg', [reading('2025-01-01', 0), reading('2025-12-31', 600)]),
					meter('m-og', 'og', [reading('2025-01-01', 0), reading('2025-12-31', 400, true)])
				]
			}),
			options
		);
		// 700 € × 60 % + 300 € × 60 % = 600 €.
		expect(mixed.leases.find((l) => l.leaseId === 'l-eg')?.costsTotal).toBe(60000);
	});

	it('warns about a unit without a meter of the kind, but not for a parking space', () => {
		const input = small({
			items: [item('i-heizung', 'Fernwärme', 'c-heizung', 'k-consumption', 100000)],
			keys: [key('k-consumption', 'Wärme', 'consumption', { meterKind: 'heat' })],
			meters: [meter('m-eg', 'eg', [reading('2025-01-01', 0), reading('2025-12-31', 600)])]
		});
		expect(computeStatement(input, options).property.warnings).toMatchObject([
			{ code: 'missing_meter', blocking: true, unitId: 'og', href: '/objekte/p/zaehler' }
		]);
		input.units[1].kind = 'parking';
		expect(computeStatement(input, options).property.warnings).toEqual([]);
	});

	it('keeps the non-heating shares of a Pauschale lease with the landlord', () => {
		const input = small({
			items: [
				item('i-grundsteuer', 'Grundsteuer', 'c-grundsteuer', 'k-area', 100000),
				item('i-heizung', 'Fernwärme', 'c-heizung', 'k-consumption', 100000)
			],
			keys: [
				key('k-area', 'Wohnfläche', 'area'),
				key('k-consumption', 'Wärme', 'consumption', { meterKind: 'heat' })
			]
		});
		input.leases[1].operatingCostModel = 'flat';
		const result = computeStatement(input, options);
		const og = result.leases.find((l) => l.leaseId === 'l-og')!;
		// OG gets the heating line only (400 of 1.000 kWh = 400 €); the 40 % area share of the
		// Grundsteuer (400 €) is excluded and the heating prepayment alone counts.
		expect(og.lines.map((line) => [line.categoryName, line.amount])).toEqual([['Heizung', 40000]]);
		expect(og.excluded).toEqual([
			{
				itemId: 'i-grundsteuer',
				description: 'Grundsteuer',
				categoryName: 'Grundsteuer',
				amount: 40000,
				reason: 'Betriebskostenpauschale'
			}
		]);
		expect(og.prepaymentsTotal).toBe(12 * 5000);
		expect(og.balance).toBe(40000 - 60000);
		expect(result.property.excludedTotal).toBe(40000);
		expect(result.property.warnings).toMatchObject([
			{ code: 'flat_lease', leaseId: 'l-og', href: '/vertraege/l-og' }
		]);

		// Both Pauschale: the lease gets no statement at all.
		input.leases[1].heatingCostModel = 'flat';
		const both = computeStatement(input, options);
		expect(both.leases.map((l) => l.leaseId)).toEqual(['l-eg']);
		expect(both.property.excludedTotal).toBe(80000);
	});

	it('takes the amounts of a direct key from the cost item', () => {
		const input = small({
			items: [
				item('i-messdienst', 'Abrechnung Messdienst', 'c-heizung', 'k-direct', 100000, {
					unitAmounts: [
						{ unitId: 'eg', amount: 65000 },
						{ unitId: 'og', amount: 35000 }
					]
				})
			],
			keys: [key('k-direct', 'Beträge je Einheit', 'direct')]
		});
		const result = computeStatement(input, options);
		expect(result.leases.map((l) => [l.leaseId, l.costsTotal])).toEqual([
			['l-eg', 65000],
			['l-og', 35000]
		]);
		expect(result.leases[0].lines[0]).toMatchObject({
			keyKind: 'direct',
			keyTotal: 'laut Beleg',
			share: 'Betrag laut Beleg · 365 von 365 Tagen'
		});
		expect(result.property.warnings).toEqual([]);

		// Amounts that do not add up to the item leave the difference with the landlord.
		input.items[0].unitAmounts[1].amount = 30000;
		const short = computeStatement(input, options);
		expect(short.property.unallocatedTotal).toBe(5000);
		expect(short.property.warnings).toMatchObject([
			{ code: 'direct_mismatch', itemId: 'i-messdienst', blocking: false }
		]);

		// Amounts above the bill (650 + 380 = 1.030 € of 1.000 €) would bill the tenants for more
		// than the landlord paid: that blocks the approval.
		input.items[0].unitAmounts[1].amount = 38000;
		const over = computeStatement(input, options);
		expect(over.property.warnings).toMatchObject([
			{
				code: 'direct_mismatch',
				itemId: 'i-messdienst',
				blocking: true,
				message: expect.stringContaining(
					'ergeben 1.030,00\u00a0€, mehr als der Beleg über 1.000,00\u00a0€'
				)
			}
		]);
	});

	it('blocks a credit note whose direct amounts pass on less than the credit', () => {
		// A credit note of −1.000 €: amounts of −650 and −350 € pass it on in full.
		const input = small({
			items: [
				item('i-gutschrift', 'Gutschrift Messdienst', 'c-heizung', 'k-direct', -100000, {
					unitAmounts: [
						{ unitId: 'eg', amount: -65000 },
						{ unitId: 'og', amount: -35000 }
					]
				})
			],
			keys: [key('k-direct', 'Beträge je Einheit', 'direct')]
		});
		const full = computeStatement(input, options);
		expect(full.leases.map((l) => l.costsTotal)).toEqual([-65000, -35000]);
		expect(full.property.warnings).toEqual([]);

		// −650 − 300 = −950 €: the landlord would keep 50 € of the credit, so the tenants would pay
		// more than the bill. That blocks, like amounts above a bill.
		input.items[0].unitAmounts[1].amount = -30000;
		const short = computeStatement(input, options);
		expect(short.property.warnings).toEqual([
			{
				code: 'direct_mismatch',
				blocking: true,
				itemId: 'i-gutschrift',
				href: '/betriebskosten/belege/i-gutschrift',
				message:
					'Die Beträge je Einheit der Gutschrift „Gutschrift Messdienst“ ergeben -950,00 €, die Gutschrift -1.000,00 €; die Mieter erhielten weniger als die Gutschrift. Korrigiere die Beträge, bevor du die Abrechnung freigibst.'
			}
		]);

		// −650 − 400 = −1.050 €: the tenants get 50 € more than the credit, which the landlord
		// bears, like amounts below a bill.
		input.items[0].unitAmounts[1].amount = -40000;
		const over = computeStatement(input, options);
		expect(over.property.warnings).toMatchObject([
			{ code: 'direct_mismatch', itemId: 'i-gutschrift', blocking: false }
		]);
		expect(over.property.unallocatedTotal).toBe(5000);
		expect(over.leases.map((l) => l.costsTotal)).toEqual([-65000, -40000]);
	});

	it('keeps the sum of direct amounts when the item is prorated', () => {
		// 1.000 € for 1 October 2024 to 30 September 2025 (365 days, 273 in 2025) split as 333,33 +
		// 666,67 €; the item's share is 1.000 × 273 / 365 = 747,945… → 747,95 €. Prorated one by
		// one, 249,314… → 249,31 and 498,630… → 498,63 € miss a cent; rounded on the running sum,
		// 249,31 and 747,95 − 249,31 = 498,64 € add up to the item.
		const input = small({
			items: [
				item('i-messdienst', 'Abrechnung Messdienst', 'c-heizung', 'k-direct', 100000, {
					periodStart: '2024-10-01',
					periodEnd: '2025-09-30',
					unitAmounts: [
						{ unitId: 'eg', amount: 33333 },
						{ unitId: 'og', amount: 66667 }
					]
				})
			],
			keys: [key('k-direct', 'Beträge je Einheit', 'direct')]
		});
		const result = computeStatement(input, options);
		expect(result.property.items[0].total).toBe(74795);
		expect(result.leases.map((l) => l.costsTotal)).toEqual([24931, 49864]);
		expect(result.property.unallocatedTotal).toBe(0);
		expect(result.property.warnings).toEqual([]);
	});

	it('distributes by the shares of a custom key', () => {
		const input = small({
			items: [item('i-versicherung', 'Gebäudeversicherung', 'c-grundsteuer', 'k-custom', 100000)],
			keys: [
				key('k-custom', 'Miteigentumsanteile', 'custom', {
					shares: [
						{ unitId: 'eg', share: 750 },
						{ unitId: 'og', share: 250 }
					]
				})
			]
		});
		const result = computeStatement(input, options);
		expect(result.leases.map((l) => [l.leaseId, l.costsTotal])).toEqual([
			['l-eg', 75000],
			['l-og', 25000]
		]);
		expect(result.leases[0].lines[0]).toMatchObject({
			keyTotal: '1.000 Anteile',
			share: '750 von 1.000 Anteilen · 365 von 365 Tagen'
		});

		input.keys[0].shares.pop();
		expect(computeStatement(input, options).property.warnings).toMatchObject([
			{ code: 'missing_share', unitId: 'og', href: '/betriebskosten/schluessel' }
		]);
	});

	it('warns when a heating item does not follow the HeizKV', () => {
		const input = small({
			items: [item('i-heizung', 'Fernwärme', 'c-heizung', 'k-area', 100000)]
		});
		expect(computeStatement(input, options).property.warnings).toMatchObject([
			{
				code: 'heizkv_key',
				blocking: false,
				itemId: 'i-heizung',
				href: '/betriebskosten/schluessel'
			}
		]);
		const badPercent = small({
			items: [item('i-heizung', 'Fernwärme', 'c-heizung', 'k-mixed', 100000)],
			keys: [
				key('k-mixed', 'Heizung 80/20', 'mixed', { meterKind: 'heat', consumptionPercent: 80 })
			]
		});
		expect(computeStatement(badPercent, options).property.warnings).toMatchObject([
			{ code: 'heizkv_key' }
		]);
	});

	it('reports a unit without a lease and the passed deadline', () => {
		const input = small();
		input.leases.pop();
		const result = computeStatement(input, { today: '2027-01-01' });
		expect(result.property.warnings.map((w) => w.code)).toEqual(['no_lease', 'deadline_passed']);
		expect(result.property.warnings[0]).toMatchObject({
			unitId: 'og',
			href: '/objekte/p/einheiten/og'
		});
		expect(result.property.late).toBe(true);
		expect(result.leases[0].late).toBe(true);
		// The vacancy keeps OG's 40 %.
		expect(result.property.vacancyShare).toBe(40000);
		// A commercial lease is not bound by § 556 Abs. 3 BGB.
		input.leases[0].kind = 'commercial';
		const commercial = computeStatement(input, { today: '2027-01-01' });
		expect(commercial.property.late).toBe(false);
		expect(commercial.leases[0].late).toBe(false);
	});

	it('prorates a cost item that overlaps the period only in part', () => {
		const input = small({
			// 1 October 2024 to 30 September 2025: 365 days, 273 of them in 2025.
			items: [
				item('i-grundsteuer', 'Grundsteuer', 'c-grundsteuer', 'k-area', 36500, {
					periodStart: '2024-10-01',
					periodEnd: '2025-09-30'
				})
			]
		});
		const result = computeStatement(input, options);
		expect(result.property.costsTotal).toBe(27300);
	});

	it('shares a cost item that covers part of the period by the occupancy within it', () => {
		// Grundsteuer (area) and Müll (persons) for January to September 2025, 273 days, 273 € each.
		// OG changes tenants on 1 July (A: 2 persons until 30 June, B: 1 person until 30 November)
		// and is vacant in December, after the items end.
		const input = small({
			leases: [
				small().leases[0],
				lease(
					'l-og-a',
					['og'],
					{ start: '2024-01-01', end: '2025-06-30' },
					2,
					{ operating: 10000, heating: 5000, months: months(1, 6) },
					{ salutation: 'Frau', firstName: 'Anna', lastName: 'Alt' }
				),
				lease(
					'l-og-b',
					['og'],
					{ start: '2025-07-01', end: '2025-11-30' },
					1,
					{ operating: 10000, heating: 5000, months: months(7, 11) },
					{ salutation: 'Herr', firstName: 'Bernd', lastName: 'Neu' }
				)
			],
			items: [
				item('i-grundsteuer', 'Grundsteuer', 'c-grundsteuer', 'k-area', 27300, {
					periodEnd: '2025-09-30'
				}),
				item('i-muell', 'Müllabfuhr', 'c-muell', 'k-persons', 27300, { periodEnd: '2025-09-30' })
			]
		});
		const result = computeStatement(input, options);
		const byLease = Object.fromEntries(result.leases.map((l) => [l.leaseId, l]));
		// OG's 40 % of the Grundsteuer, 109,20 €, by the days of January to September: A 181 and
		// B 92 of 273, not 181 and 153 of 365 with 31 days of vacancy.
		expect(lineAmounts(byLease['l-og-a']).Grundsteuer).toBe(7240);
		expect(lineAmounts(byLease['l-og-b']).Grundsteuer).toBe(3680);
		expect(byLease['l-og-b'].lines[0].share).toBe('40\u00a0m² von 100\u00a0m² · 92 von 273 Tagen');
		// Person-days of January to September: EG 2 × 273 = 546, OG 2 × 181 + 1 × 92 = 454, no
		// vacancy. OG 273 € × 454 / 1.000 = 123,942 → 123,94 €; A 362 / 454 = 98,824… → 98,82 €, B 92 / 454 = 25,115… →
		// 25,12 € (the remaining cent goes to the larger remainder).
		expect(lineAmounts(byLease['l-eg']).Müllbeseitigung).toBe(14906);
		expect(lineAmounts(byLease['l-og-a']).Müllbeseitigung).toBe(9882);
		expect(lineAmounts(byLease['l-og-b']).Müllbeseitigung).toBe(2512);
		expect(byLease['l-og-b'].lines[1]).toMatchObject({
			keyTotal: '1.000 Personentage',
			share: '454 von 1.000 Personentagen · davon 92 Personentage'
		});
		// The December vacancy lies outside both items.
		expect(result.property.vacancyShare).toBe(0);
		const leaseSum = result.leases.reduce((sum, l) => sum + l.costsTotal, 0);
		expect(leaseSum).toBe(2 * 27300);
	});

	it('blocks an item that no weight of its key carries', () => {
		// No unit has a floor area: by area, the 1.000 € would reach nobody.
		const input = small();
		for (const unit of input.units) unit.floorArea = null;
		const result = computeStatement(input, options);
		expect(result.leases.map((l) => l.costsTotal)).toEqual([0, 0]);
		expect(result.property.items[0]).toMatchObject({
			total: 100000,
			allocated: 0,
			unallocated: 100000
		});
		expect(result.property.unallocatedTotal).toBe(100000);
		expect(result.property.warnings.filter((w) => w.blocking)).toEqual([
			{
				code: 'no_weight',
				blocking: true,
				itemId: 'i-grundsteuer',
				href: '/betriebskosten/belege/i-grundsteuer',
				message:
					'Der Beleg „Grundsteuer“ lässt sich nach dem Umlageschlüssel „Wohnfläche“ nicht verteilen, weil danach niemand einen Anteil hat (1.000,00 €); ergänze die Angaben oder wähle einen anderen Schlüssel, bevor du die Abrechnung freigibst.'
			}
		]);

		// Under a 70/30 key the consumption part still reaches the tenants; the 30 % by area do not.
		const mixed = small({
			items: [item('i-heizung', 'Fernwärme', 'c-heizung', 'k-mixed', 100000)],
			keys: [
				key('k-mixed', 'Heizung 70/30', 'mixed', { meterKind: 'heat', consumptionPercent: 70 })
			]
		});
		for (const unit of mixed.units) unit.floorArea = null;
		const heating = computeStatement(mixed, options);
		expect(heating.leases.map((l) => l.costsTotal)).toEqual([42000, 28000]);
		expect(heating.property.unallocatedTotal).toBe(30000);
		expect(heating.property.warnings.filter((w) => w.blocking).map((w) => w.code)).toEqual([
			'no_weight'
		]);
	});

	it('refuses a period longer than twelve months or one that cuts a month', () => {
		expect(validatePeriod('2025-01-01', '2025-12-31')).toBeUndefined();
		expect(validatePeriod('2025-07-01', '2026-06-30')).toBeUndefined();
		expect(validatePeriod('2025-01-01', '2026-01-31')).toBe(
			'Der Abrechnungszeitraum darf höchstens 12 Monate umfassen (§ 556 Abs. 3 BGB).'
		);
		// 15.01.2025–14.01.2026 would count January 2025 and January 2026 in full: 13 months of
		// prepayments against 365 days of costs.
		const cut =
			'Der Abrechnungszeitraum muss am Ersten eines Monats beginnen und am Letzten eines Monats enden.';
		expect(validatePeriod('2025-01-15', '2026-01-14')).toBe(cut);
		expect(validatePeriod('2025-01-01', '2025-12-30')).toBe(cut);
		expect(validatePeriod('2024-03-01', '2025-02-28')).toBeUndefined();
		expect(() =>
			computeStatement(small({ period: { start: '2025-01-15', end: '2026-01-14' } }), options)
		).toThrow('am Ersten eines Monats');
		expect(validatePeriod('2025-12-31', '2025-01-01')).toBe(
			'Das Ende des Zeitraums liegt vor dem Beginn.'
		);
		expect(() =>
			computeStatement(small({ period: { start: '2025-01-01', end: '2026-01-31' } }), options)
		).toThrow('höchstens 12 Monate');
	});
});

describe('helpers', () => {
	it('counts the § 556 Abs. 3 deadlines to the end of the twelfth month', () => {
		expect(statementDeadline('2025-12-31')).toBe('2026-12-31');
		expect(statementDeadline('2025-06-30')).toBe('2026-06-30');
		expect(statementDeadline('2025-06-15')).toBe('2026-06-30');
		// Received on 15.03.2026: objections until 31.03.2027, not 15.03.2027.
		expect(objectionDeadline('2026-03-15')).toBe('2027-03-31');
		expect(objectionDeadline('2026-02-01')).toBe('2027-02-28');
	});

	it('suggests the new prepayments per kind, scaled to a year', () => {
		const result = computeStatement(scenario(), options);
		const byLease = Object.fromEntries(result.leases.map((lease) => [lease.leaseId, lease]));
		// EG, all year: operating 471,54 + 266,91 + 300,00 = 1.038,45 € / 12 = 86,54 €; heating
		// 1.308,21 € / 12 = 109,0175 → 109,02 €. Not 2.346,66 / 12 = 195,56 € into one field.
		expect(suggestedPrepayments(byLease['l-eg'])).toEqual({ operating: 8654, heating: 10902 });
		// OG B, 184 days: operating 209,84 + 67,27 + 151,23 = 428,34 € × 365 / 184 / 12 = 70,808… →
		// 70,81 €; heating 539,20 € × 365 / 184 / 12 = 89,134… → 89,13 €.
		expect(suggestedPrepayments(byLease['l-og-b'])).toEqual({ operating: 7081, heating: 8913 });
		// Without heating lines (a Heizkostenpauschale) the heating prepayment is left alone.
		const flat = { ...byLease['l-eg'], lines: byLease['l-eg'].lines.filter((l) => !l.heating) };
		expect(suggestedPrepayments(flat)).toEqual({ operating: 8654, heating: null });
	});

	it('labels periods, balances and leases', () => {
		expect(periodLabel('2025-01-01', '2025-12-31')).toBe('2025');
		expect(periodLabel('2025-07-01', '2026-06-30')).toBe('01.07.2025 – 30.06.2026');
		expect(balanceLabel(1)).toBe('Nachzahlung');
		expect(balanceLabel(-1)).toBe('Guthaben');
		expect(balanceLabel(0)).toBe('ausgeglichen');
		expect(
			leaseLabel(
				[{ name: 'EG' }, { name: 'Stellplatz 1' }],
				[
					{
						salutation: null,
						firstName: 'Max',
						lastName: 'Müller',
						street: null,
						postalCode: null,
						city: null
					}
				]
			)
		).toBe('EG + Stellplatz 1 · Max Müller');
	});

	it('finds the persons valid on a day, falling back to the earliest entry', () => {
		const entries = [
			{ validFrom: '2025-01-01', persons: 2 },
			{ validFrom: '2025-07-01', persons: 3 }
		];
		expect(personsOn(entries, '2024-12-31')).toBe(2);
		expect(personsOn(entries, '2025-06-30')).toBe(2);
		expect(personsOn(entries, '2025-07-01')).toBe(3);
		expect(personsOn([], '2025-01-01')).toBe(1);
	});
});
