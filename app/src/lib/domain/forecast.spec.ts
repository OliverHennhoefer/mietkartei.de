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

	it('keeps to one property', () => {
		const result = forecast(input(), { propertyId: 'hof' });
		expect(result).toMatchObject({ monthlyCosts: 0, increases: [], settlements: [] });
		expect(result.months[0].rent).toBe(0);
	});
});
