import { describe, expect, it } from 'vitest';
import { analyse, type AnalysisInput, type AnalysisOptions } from './analysis';

// Two properties: Haus with EG (60 m², let all year) and OG (40 m², let from July), Hof with
// one unit never let. 2026, viewed on 2026-12-31.

function input(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
	const rent = (leaseId: string, months: number[], baseRent: number) =>
		months.map((month) => ({
			leaseId,
			period: `2026-${String(month).padStart(2, '0')}`,
			kind: 'rent' as const,
			baseRent,
			amount: baseRent + 20000
		}));
	return {
		properties: [
			{ id: 'haus', name: 'Haus' },
			{ id: 'hof', name: 'Hof' }
		],
		units: [
			{ id: 'eg', propertyId: 'haus', name: 'EG', floorArea: 60, since: '2020-01-01' },
			{ id: 'og', propertyId: 'haus', name: 'OG', floorArea: 40, since: '2020-01-01' },
			{ id: 'hof1', propertyId: 'hof', name: 'Hof 1', floorArea: null, since: '2026-07-01' }
		],
		leases: [
			{ id: 'l-eg', unitId: 'eg', extraUnitIds: [], startDate: '2024-01-01', endDate: null },
			{
				id: 'l-og-old',
				unitId: 'og',
				extraUnitIds: [],
				startDate: '2024-01-01',
				endDate: '2025-12-31'
			},
			{ id: 'l-og', unitId: 'og', extraUnitIds: [], startDate: '2026-07-01', endDate: null }
		],
		charges: [
			...rent('l-eg', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 60000),
			{ leaseId: 'l-og-old', period: '2025-12', kind: 'rent', baseRent: 40000, amount: 60000 },
			...rent('l-og', [7, 8, 9, 10, 11, 12], 50000)
		],
		payments: [
			{ leaseId: 'l-eg', date: '2026-01-03', amount: 80000 },
			{ leaseId: 'l-eg', date: '2026-02-03', amount: 80000 },
			{ leaseId: 'l-og', date: '2026-07-03', amount: 70000 },
			{ leaseId: 'l-eg', date: '2025-12-03', amount: 80000 }
		],
		expenses: [
			{
				id: 'e1',
				date: '2026-03-10',
				amount: 120000,
				category: 'maintenance',
				propertyId: 'haus',
				unitId: 'eg',
				description: 'Bad'
			},
			{
				id: 'e2',
				date: '2026-07-10',
				amount: 30000,
				category: 'operating_costs',
				propertyId: 'haus',
				unitId: null,
				description: 'Versicherung'
			},
			{
				id: 'e3',
				date: '2026-05-10',
				amount: 50000,
				category: 'management',
				propertyId: null,
				unitId: null,
				description: 'Steuerberatung'
			},
			{
				id: 'e4',
				date: '2025-05-10',
				amount: 99900,
				category: 'maintenance',
				propertyId: 'haus',
				unitId: 'og',
				description: 'Vorjahr'
			}
		],
		deposits: [
			{ leaseId: 'l-eg', amount: 180000 },
			{ leaseId: 'l-og-old', amount: 120000 },
			{ leaseId: 'l-og-old', amount: -120000 }
		],
		...overrides
	};
}

const year: AnalysisOptions = {
	range: { start: '2026-01-01', end: '2026-12-31' },
	propertyId: null,
	granularity: 'month',
	today: '2026-12-31'
};

describe('analyse', () => {
	it('sums what was charged, received and paid out in the period', () => {
		const { totals } = analyse(input(), year);
		expect(totals.charged).toBe(12 * 80000 + 6 * 70000);
		expect(totals.baseRent).toBe(12 * 60000 + 6 * 50000);
		expect(totals.received).toBe(230000);
		expect(totals.expenses).toBe(200000);
		expect(totals.net).toBe(30000);
		expect(totals.collectionRate).toBeCloseTo(230000 / 1380000);
	});

	it('puts every flow into its month', () => {
		const { series } = analyse(input(), year);
		expect(series).toHaveLength(12);
		expect(series[0]).toEqual({
			key: '2026-01',
			charged: 80000,
			received: 80000,
			expenses: 0,
			net: 80000
		});
		expect(series[6]).toMatchObject({
			key: '2026-07',
			charged: 150000,
			received: 70000,
			expenses: 30000
		});
	});

	it('counts vacancy from when a unit counts, up to today, and prices it at the last rent', () => {
		const { units, totals } = analyse(input(), year);
		const og = units.find((unit) => unit.id === 'og')!;
		const hof = units.find((unit) => unit.id === 'hof1')!;
		expect(og.vacantDays).toBe(181);
		expect(og.lostRent).toBe(Math.round((181 * 50000 * 12) / 365));
		expect(hof.unitDays).toBe(184);
		expect(hof.vacantDays).toBe(184);
		// Never let: no rent to price the vacancy with.
		expect(hof.lostRent).toBe(0);
		expect(totals.vacantDays).toBe(365);
		expect(totals.vacancyRate).toBeCloseTo(365 / (365 * 2 + 184));
	});

	it('prices vacancy at the last full month, not a prorated final month', () => {
		const data = input({
			leases: [
				{
					id: 'l-eg',
					unitId: 'eg',
					extraUnitIds: [],
					startDate: '2024-01-01',
					endDate: '2026-01-15'
				}
			],
			charges: [
				{ leaseId: 'l-eg', period: '2025-12', kind: 'rent', baseRent: 60000, amount: 80000 },
				{ leaseId: 'l-eg', period: '2026-01', kind: 'rent', baseRent: 29032, amount: 38710 }
			]
		});
		const eg = analyse(data, year).units.find((unit) => unit.id === 'eg')!;
		expect(eg.vacantDays).toBe(350);
		expect(eg.lostRent).toBe(Math.round((350 * 60000 * 12) / 365));
	});

	it('does not count vacancy after today', () => {
		const { units } = analyse(input(), { ...year, today: '2026-03-31' });
		expect(units.find((unit) => unit.id === 'og')!.unitDays).toBe(90);
	});

	it('averages the base rent per m² over the charged months', () => {
		const { totals, units } = analyse(input(), year);
		expect(units.find((unit) => unit.id === 'eg')!.rentPerSqm).toBe(10);
		expect(units.find((unit) => unit.id === 'og')!.rentPerSqm).toBe(12.5);
		expect(totals.rentPerSqm).toBeCloseTo((12 * 600 + 6 * 500) / (12 * 60 + 6 * 40));
	});

	it('gives each unit its own expenses and each property all of its expenses', () => {
		const { units, properties } = analyse(input(), year);
		expect(units.find((unit) => unit.id === 'eg')).toMatchObject({ expenses: 120000, net: 40000 });
		expect(properties.find((property) => property.id === 'haus')).toMatchObject({
			unitCount: 2,
			floorArea: 100,
			expenses: 150000,
			received: 230000,
			net: 80000
		});
		expect(properties.find((property) => property.id === 'hof')!.rentPerSqm).toBeNull();
	});

	it('leaves portfolio-wide expenses out when one property is viewed', () => {
		const { totals, units, properties, byCategory } = analyse(input(), {
			...year,
			propertyId: 'haus'
		});
		expect(totals.expenses).toBe(150000);
		expect(units.map((unit) => unit.id)).toEqual(['eg', 'og']);
		expect(properties.map((property) => property.id)).toEqual(['haus']);
		expect(byCategory.map((row) => row.category)).toEqual(['maintenance', 'operating_costs']);
	});

	it('sorts the categories and the largest expenses by amount', () => {
		const { byCategory, topExpenses } = analyse(input(), year);
		expect(byCategory).toEqual([
			{ category: 'maintenance', amount: 120000 },
			{ category: 'management', amount: 50000 },
			{ category: 'operating_costs', amount: 30000 }
		]);
		expect(topExpenses.map((expense) => expense.id)).toEqual(['e1', 'e3', 'e2']);
	});

	it('shows years over a longer range', () => {
		const { series, totals } = analyse(input(), {
			...year,
			range: { start: '2025-01-01', end: '2026-12-31' },
			granularity: 'year'
		});
		expect(series.map((point) => point.key)).toEqual(['2025', '2026']);
		expect(series[0]).toMatchObject({ charged: 60000, received: 80000, expenses: 99900 });
		expect(totals.expenses).toBe(299900);
	});

	it('holds the deposits of the leases in view', () => {
		expect(analyse(input(), year).totals.depositsHeld).toBe(180000);
		expect(analyse(input(), { ...year, propertyId: 'hof' }).totals.depositsHeld).toBe(0);
	});

	it('counts an extra unit as let for vacancy', () => {
		const data = input({
			leases: [
				{ id: 'l-eg', unitId: 'eg', extraUnitIds: ['hof1'], startDate: '2024-01-01', endDate: null }
			]
		});
		expect(analyse(data, year).units.find((unit) => unit.id === 'hof1')!.vacantDays).toBe(0);
	});
});
