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
	type PrepaymentCharge,
	type StatementInput,
	type StatementItem,
	type StatementKey,
	type StatementLease
} from './statement';

// The reference scenario of PROTOTYPE.md: Lindenstraße 4 (residential, vacancyPersons 1) with
// three units and the year 2025.
//
//   EG  72,5 m², lease all year, 2 persons, prepayments 150 + 50 € (ledger from February, so
//       January's prepayment comes from the rent history: 11 charged months + 1 from history)
//   OG  64 m², tenant change on 30 June: lease A (2 persons, 120 + 60 €) until 30 June, lease B
//       (1 person, 100 + 50 €) from 1 July; the heat meter was read on 30 June
//   DG  48 m², lease (1 person, 80 + 40 €) until 31 August, vacant from 1 September, no reading
//       at the change
//
// Cost items: Grundsteuer 1.200 € (area), Müll 600 € (persons), Hausmeister 900 € (units),
// Heizung 3.000 € (mixed 70/30 on heat meters EG 1.000 kWh, OG 600 + 400 kWh, DG 200 kWh; CO₂
// data 25.000 kWh gas, 5.025 kg, 300 € CO₂ cost), Verwaltung 500 € (not allocable).

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

/** `rent` charges for the months, same prepayments every month. */
function charges(months: string[], operating: number, heating: number): PrepaymentCharge[] {
	return months.map((period) => ({
		period,
		operatingCostPrepayment: operating,
		heatingCostPrepayment: heating
	}));
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
		fuel: null,
		fuelKwh: null,
		co2Kg: null,
		co2Cost: null,
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
			buildingUse: 'residential',
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
			item('i-heizung', 'Gasrechnung', 'c-heizung', 'k-heat', 300000, {
				fuel: 'gas',
				fuelKwh: 25000,
				co2Kg: 5025,
				co2Cost: 30000
			}),
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
		// CO₂: 5.025 kg / 184,5 m² = 27,24 kg/m² → tier 27–32 → landlord 40 % of 300 € = 120 €.
		expect(result.property.landlordCo2Share).toBe(12000);
		expect(result.property.items.find((i) => i.itemId === 'i-heizung')?.co2).toMatchObject({
			fuel: 'gas',
			co2Kg: 5025,
			co2Cost: 30000,
			area: 184.5,
			landlordPercent: 40,
			landlordAmount: 12000,
			tenantAmount: 18000
		});
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
			// Heizung: 3.000 € − 120 € CO₂ landlord share = 2.880 €; 70 % = 2.016 € by consumption
			// (EG 1.000 of 2.200 kWh → 916,363… → 916,37 € with the remainder), 30 % = 864 € by area
			// (72,5 / 184,5 → 339,512… → 339,51 €): 916,37 + 339,51 = 1.255,88 €.
			Heizung: 125588
		});
		const heating = eg.lines.find((line) => line.categoryName === 'Heizung')!;
		expect(heating).toMatchObject({
			heating: true,
			itemTotal: 300000,
			allocated: 288000,
			keyName: 'Heizung 70/30',
			keyKind: 'mixed',
			keyTotal: '70 % nach Verbrauch: 2.200 kWh · 30 % nach Fläche: 184,5 m²'
		});
		expect(heating.share).toBe(
			'70 % nach Verbrauch: 1.000 von 2.200 kWh · 30 % nach Fläche: 72,5 m² von 184,5 m² · 365 von 365 Tagen'
		);
		expect(heating.co2?.landlordPercent).toBe(40);
		expect(eg.lines.find((line) => line.categoryName === 'Grundsteuer')).toMatchObject({
			keyTotal: '184,5 m²',
			share: '72,5 m² von 184,5 m² · 365 von 365 Tagen',
			betrkvItem: 1
		});
		expect(eg.lines.find((line) => line.categoryName === 'Müllbeseitigung')).toMatchObject({
			keyTotal: '1.641 Personentage',
			share: '730 von 1.641 Personentagen'
		});
		// 471,54 + 266,91 + 300,00 + 1.255,88 = 2.294,33 €.
		expect(eg.costsTotal).toBe(229433);
		// Prepayments: 11 charged months (February to December) plus January from the rent
		// history, each 150 + 50 € = 200 €: 2.400 €.
		expect(eg.prepayments).toHaveLength(12);
		expect(eg.prepayments[0]).toEqual({
			period: '2025-01',
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			amount: 20000,
			source: 'history'
		});
		expect(eg.prepayments[1].source).toBe('charge');
		expect(eg.prepaymentsTotal).toBe(240000);
		// 2.294,33 − 2.400,00 = −105,67 € Guthaben.
		expect(eg.balance).toBe(-10567);
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
			// OG heating: consumption 2.016 € × 1.000 / 2.200 = 916,36 €, A 600 of 1.000 kWh by the
			// reading of 30 June = 549,816 → 549,82 €; area 864 € × 64 / 184,5 = 299,71 €, A 181 / 365
			// days = 148,623… → 148,62 €: 698,44 €.
			Heizung: 69844
		});
		expect(lineAmounts(b)).toEqual({
			// 416,26 − 206,42
			Grundsteuer: 20984,
			// 199,63 − 132,36
			Müllbeseitigung: 6727,
			// 300,00 − 148,77
			Hauswart: 15123,
			// 916,36 − 549,82 = 366,54 and 299,71 − 148,62 = 151,09
			Heizung: 51763
		});
		const heatingA = a.lines.find((line) => line.categoryName === 'Heizung')!;
		expect(heatingA.method).toBe('readings');
		expect(heatingA.share).toContain('davon 600 kWh laut Zwischenablesung');
		expect(heatingA.share).toContain('181 von 365 Tagen');
		expect(a.lines.find((line) => line.categoryName === 'Müllbeseitigung')?.share).toBe(
			'546 von 1.641 Personentagen · davon 362 Personentage'
		);
		// A: 206,42 + 132,36 + 148,77 + 698,44 = 1.185,99 €; prepayments 6 × 180 € = 1.080 €.
		expect(a.costsTotal).toBe(118599);
		expect(a.prepaymentsTotal).toBe(108000);
		expect(a.balance).toBe(10599);
		// B: 209,84 + 67,27 + 151,23 + 517,63 = 945,97 €; prepayments 6 × 150 € = 900 €.
		expect(b.costsTotal).toBe(94597);
		expect(b.prepaymentsTotal).toBe(90000);
		expect(b.balance).toBe(4597);
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
			// DG heating: consumption 2.016 € × 200 / 2.200 = 183,27 €, no reading on 31 August, so
			// Gradtagszahlen January–August 610 of 1.000: 111,794… → 111,79 €; area 864 € × 48 / 184,5
			// = 224,78 €, 243 / 365 days = 149,648… → 149,65 €: 261,44 €.
			Heizung: 26144
		});
		const heating = dg.lines.find((line) => line.categoryName === 'Heizung')!;
		expect(heating.method).toBe('degree_days');
		expect(heating.share).toContain('davon 61 % nach Gradtagszahlen');
		// 207,85 + 88,85 + 199,73 + 261,44 = 757,87 €; prepayments 8 × 120 € = 960 €.
		expect(dg.costsTotal).toBe(75787);
		expect(dg.prepaymentsTotal).toBe(96000);
		expect(dg.balance).toBe(-20213);
		expect(dg.warnings.map((warning) => warning.code)).toEqual(['no_interim_reading']);
		// The vacancy: 104,35 + 44,61 + 100,27 + 71,48 + 75,13 = 395,84 € stay with the landlord.
		expect(result.property.vacancyShare).toBe(39584);
		expect(result.property.items.find((i) => i.itemId === 'i-muell')?.vacancyShare).toBe(4461);
	});

	it('adds up: every allocated cent lands on a lease or the vacancy', () => {
		const leaseSum = result.leases.reduce((sum, lease) => sum + lease.costsTotal, 0);
		// 2.294,33 + 1.185,99 + 945,97 + 757,87 + 395,84 = 5.580,00 = 5.700 − 120 € CO₂.
		expect(leaseSum + result.property.vacancyShare).toBe(558000);
		expect(result.property.nachzahlungen).toBe(10599 + 4597);
		expect(result.property.guthaben).toBe(10567 + 20213);
		expect(result.property.excludedTotal).toBe(0);
		expect(result.property.unallocatedTotal).toBe(0);
		expect(result.property.leases.map((lease) => lease.label)).toEqual([
			'DG · Dora Dach',
			'OG · Anna Alt',
			'EG · Max Müller',
			'OG · Bernd Neu'
		]);
	});

	it('freezes the shapes with the result version', () => {
		expect(result.property.resultVersion).toBe(1);
		for (const lease of result.leases) {
			expect(lease.resultVersion).toBe(1);
			expect(lease.landlord.name).toBe('Erika Vermieter');
			expect(lease.property.name).toBe('Lindenstraße 4');
			expect(lease.approvedOn).toBeNull();
			expect(lease.posted).toBeNull();
		}
	});

	it('is deterministic', () => {
		expect(computeStatement(scenario(), options)).toEqual(result);
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

describe('computeStatement CO₂ split (CO2KostAufG)', () => {
	const scenarioWith = (items: StatementItem[]) => {
		const input = scenario();
		input.items = [...input.items.filter((entry) => entry.id !== 'i-heizung'), ...items];
		return computeStatement(input, options);
	};
	const heating = (id: string, overrides: Partial<StatementItem>) =>
		item(id, 'Heizöl', 'c-heizung', 'k-heat', 150000, { fuel: 'oil', ...overrides });

	it('takes the tier from the emissions of all fuel bills of the year', () => {
		// The year's fuel as two oil deliveries of 1.500 € with 2.512,5 kg and 150 € CO₂ cost each.
		// Each alone gives 2.512,5 / 184,5 = 13,6 kg/m² (10 %); the building emits 5.025 kg =
		// 27,24 kg/m² → 40 %: 60 € of each delivery's CO₂ cost, 120 € in all, as with one bill.
		const result = scenarioWith([
			heating('i-oel-1', { co2Kg: 2512.5, co2Cost: 15000 }),
			heating('i-oel-2', { co2Kg: 2512.5, co2Cost: 15000 })
		]);
		expect(result.property.landlordCo2Share).toBe(12000);
		for (const id of ['i-oel-1', 'i-oel-2']) {
			expect(result.property.items.find((entry) => entry.itemId === id)?.co2).toMatchObject({
				co2Kg: 2512.5,
				buildingCo2Kg: 5025,
				area: 184.5,
				landlordPercent: 40,
				landlordAmount: 6000,
				tenantAmount: 9000
			});
		}
	});

	it('prorates the kg of a bill that covers more than the period', () => {
		// One bill for 2024 and 2025 (731 days): 10.050 kg, 600 € CO₂ cost. In 2025 (365 days):
		// 10.050 × 365 / 731 = 5.018,1 kg = 27,2 kg/m² → 40 % of 600 × 365 / 731 = 299,59 € =
		// 119,84 €; the whole bill's kg would give 54,5 kg/m² → 95 %.
		const result = scenarioWith([
			heating('i-oel', {
				periodStart: '2024-01-01',
				periodEnd: '2025-12-31',
				amount: 600000,
				co2Kg: 10050,
				co2Cost: 60000
			})
		]);
		expect(result.property.items.find((entry) => entry.itemId === 'i-oel')?.co2).toMatchObject({
			co2Kg: 10050,
			buildingCo2Kg: 5018.1,
			co2Cost: 29959,
			landlordPercent: 40,
			landlordAmount: 11984
		});
	});

	it('blocks the approval when the floor area for the CO₂ tier is missing', () => {
		const input = scenario();
		input.units = input.units.map((unit) => ({ ...unit, floorArea: null }));
		const result = computeStatement(input, options);
		const warning = result.property.warnings.find((entry) => entry.code === 'co2_missing_area');
		expect(warning).toMatchObject({ blocking: true, itemId: 'i-heizung' });
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
		// 1.255,88 € / 12 = 104,656… → 104,66 €. Not 2.294,33 / 12 = 191,19 € into one field.
		expect(suggestedPrepayments(byLease['l-eg'])).toEqual({ operating: 8654, heating: 10466 });
		// OG B, 184 days: operating 209,84 + 67,27 + 151,23 = 428,34 € × 365 / 184 / 12 = 70,808… →
		// 70,81 €; heating 517,63 € × 365 / 184 / 12 = 85,568… → 85,57 €.
		expect(suggestedPrepayments(byLease['l-og-b'])).toEqual({ operating: 7081, heating: 8557 });
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
