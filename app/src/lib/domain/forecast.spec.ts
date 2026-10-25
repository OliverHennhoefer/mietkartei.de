import { describe, expect, it } from 'vitest';
import { forecast, type ForecastInput, type ForecastLease } from './forecast';
import type { HistoryChange } from './index-rent';

// Today is 15.03.2026. Three leases in one house: a fixed rent unchanged since 2023, a Staffel
// with a step in August 2026, an Indexmiete with a reference of 100 and the index now at 110.

const today = '2026-03-15';

function change(validFrom: string, baseRent: number, extra: Partial<HistoryChange> = {}) {
	return {
		validFrom,
		baseRent,
		operatingCostPrepayment: 150_00,
		heatingCostPrepayment: 50_00,
		status: 'approved' as const,
		reason: 'initial' as const,
		indexMonth: null,
		indexValue: null,
		indexBaseYear: '2020',
		...extra
	};
}

function lease(id: string, overrides: Partial<ForecastLease>): ForecastLease {
	return {
		id,
		label: id,
		propertyId: 'haus',
		kind: 'residential',
		rentModel: 'fixed',
		startDate: '2023-01-01',
		endDate: null,
		indexBaseMonth: null,
		indexBaseValue: null,
		indexBaseYear: '2020',
		operatingCostModel: 'prepayment',
		heatingCostModel: 'prepayment',
		changes: [change('2023-01-01', 1000_00)],
		...overrides
	};
}

function input(overrides: Partial<ForecastInput> = {}): ForecastInput {
	return {
		today,
		leases: [
			lease('fest', {}),
			lease('staffel', {
				rentModel: 'graduated',
				startDate: '2025-08-01',
				changes: [
					change('2025-08-01', 800_00),
					change('2026-08-01', 850_00, { reason: 'graduated' })
				]
			}),
			lease('index', {
				rentModel: 'indexed',
				startDate: '2024-01-01',
				indexBaseMonth: '2023-10',
				indexBaseValue: 100,
				changes: [change('2024-01-01', 900_00)]
			})
		],
		indexValues: [{ month: '2026-01', value: 110, baseYear: '2020' }],
		// 2.400 € over the last twelve months: 200 € a month.
		expenses: [
			{ date: '2025-03-10', amount: 1200_00, category: 'maintenance', propertyId: 'haus' },
			{ date: '2026-02-10', amount: 1200_00, category: 'operating_costs', propertyId: 'haus' },
			{ date: '2026-03-01', amount: 9999_00, category: 'maintenance', propertyId: 'haus' }
		],
		statements: [
			// 2.920 € of costs over 2025; the prepayments today make 2.400 € a year.
			{ leaseId: 'fest', periodEnd: '2025-12-31', costs: 2920_00, days: 365, balance: 520_00 }
		],
		...overrides
	};
}

describe('forecast', () => {
	it('runs the rent of the next twelve months with the Staffel steps, costs at the past average', () => {
		const result = forecast(input(), { propertyId: null });
		expect(result.months).toHaveLength(12);
		expect(result.months[0]).toMatchObject({ month: '2026-04', costs: 200_00 });
		expect(result.monthlyCosts).toBe(200_00);
		// 1.000 + 800 + 900 base rent and 3 × 200 € prepayments.
		expect(result.months[0].rent).toBe(2700_00 + 600_00);
		expect(result.months.find((month) => month.month === '2026-08')!.rent).toBe(3350_00);
	});

	it('adds an index increase from the first day it may apply', () => {
		const result = forecast(input(), { propertyId: null });
		const index = result.increases.find((row) => row.kind === 'indexed')!;
		// Delivered today, it applies from the first of the month after next.
		expect(index).toMatchObject({ from: '2026-05-01', increase: 90_00, currentBaseRent: 900_00 });
		expect(result.months[0].increases).toBe(0);
		expect(result.months[1].increases).toBe(90_00);
	});

	it('lists the next Staffel step and the room up to the Kappungsgrenze', () => {
		const { increases } = forecast(input(), { propertyId: null });
		expect(increases.find((row) => row.kind === 'graduated')).toMatchObject({
			leaseId: 'staffel',
			from: '2026-08-01',
			increase: 50_00
		});
		// Unchanged since 2023: 20 % on 1.000 €, from the third month after a request today.
		expect(increases.find((row) => row.kind === 'comparative')).toMatchObject({
			leaseId: 'fest',
			from: '2026-06-01',
			increase: 200_00
		});
	});

	it('waits for the year after the last change before a comparative increase', () => {
		const { increases } = forecast(
			input({ leases: [lease('neu', { changes: [change('2025-10-01', 1000_00)] })] }),
			{ propertyId: null }
		);
		expect(increases[0]).toMatchObject({ kind: 'comparative', from: '2027-01-01' });
	});

	it('estimates the next statement from the last one at today’s prepayments', () => {
		const [estimate] = forecast(input(), { propertyId: null }).settlements;
		expect(estimate).toMatchObject({
			leaseId: 'fest',
			yearlyCosts: 2920_00,
			yearlyPrepayments: 2400_00,
			balance: 520_00,
			currentPrepayment: 200_00,
			suggestedPrepayment: 244_00
		});
	});

	it('prorates an index increase in the month the lease ends', () => {
		const data = input();
		const leases = data.leases.map((row) =>
			row.id === 'index' ? { ...row, endDate: '2026-06-15' } : row
		);
		const result = forecast({ ...data, leases }, { propertyId: null });
		const june = result.months.find((month) => month.month === '2026-06')!;
		expect(june.increases).toBe(Math.round((90_00 * 15) / 30));
		expect(result.months.find((month) => month.month === '2026-07')!.increases).toBe(0);
	});

	it('counts the increases since the start of a lease younger than three years', () => {
		const { increases } = forecast(
			input({
				leases: [
					lease('jung', {
						startDate: '2024-01-01',
						changes: [
							change('2024-01-01', 1000_00),
							change('2025-01-01', 1100_00, { reason: 'manual' })
						]
					})
				]
			}),
			{ propertyId: null }
		);
		expect(increases[0]).toMatchObject({ kind: 'comparative', increase: 100_00 });
	});

	it('leaves a flat rate out of the prepayments a statement counts', () => {
		const data = input();
		const leases = data.leases.map((row) =>
			row.id === 'fest' ? { ...row, heatingCostModel: 'flat' as const } : row
		);
		const [estimate] = forecast({ ...data, leases }, { propertyId: null }).settlements;
		expect(estimate).toMatchObject({ currentPrepayment: 150_00, yearlyPrepayments: 1800_00 });
	});

	it('leaves out what does not apply: a pending index change, a business lease, ended and coming leases', () => {
		const data = input();
		const index = data.leases.find((row) => row.id === 'index')!;
		const result = forecast(
			{
				...data,
				leases: [
					{
						...index,
						changes: [
							...index.changes,
							change('2026-05-01', 990_00, { status: 'proposed', reason: 'indexed' })
						]
					},
					lease('laden', { kind: 'commercial' }),
					lease('alt', { endDate: '2026-01-31' }),
					lease('neu', { startDate: '2026-06-01', changes: [change('2026-06-01', 700_00)] }),
					lease('staffel', {
						rentModel: 'graduated',
						changes: [change('2023-01-01', 800_00)]
					})
				],
				statements: [
					{ leaseId: 'alt', periodEnd: '2025-12-31', costs: 2400_00, days: 365, balance: 0 },
					{ leaseId: 'neu', periodEnd: '2025-12-31', costs: 2400_00, days: 365, balance: 0 }
				]
			},
			{ propertyId: null }
		);
		expect(result.increases).toEqual([]);
		expect(result.settlements).toEqual([]);
		// The coming lease pays from June.
		expect(result.months[2].rent).toBe(
			900_00 + 200_00 + 1000_00 + 200_00 + 800_00 + 200_00 + 900_00
		);
	});

	it('waits for the year after the last index change', () => {
		const data = input();
		const index = data.leases.find((row) => row.id === 'index')!;
		const { increases } = forecast(
			{
				...data,
				leases: [
					{
						...index,
						changes: [
							...index.changes,
							change('2025-09-15', 950_00, {
								reason: 'indexed',
								indexMonth: '2023-10',
								indexValue: 100
							})
						]
					}
				]
			},
			{ propertyId: null }
		);
		expect(increases[0]).toMatchObject({ kind: 'indexed', from: '2026-09-15' });
	});

	it('keeps to one property', () => {
		const result = forecast(input(), { propertyId: 'hof' });
		expect(result).toMatchObject({ monthlyCosts: 0, increases: [], settlements: [] });
		expect(result.months[0].rent).toBe(0);
	});
});
