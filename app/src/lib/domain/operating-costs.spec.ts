import { describe, expect, it } from 'vitest';
import {
	applyCategoryDefaults,
	defaultCostPeriod,
	defaultMeterUnit,
	filterYears,
	sumByCategory,
	unitAmountsSummary
} from './operating-costs';

describe('defaultMeterUnit', () => {
	it('measures water in cubic metres and energy in kilowatt hours', () => {
		expect(defaultMeterUnit('cold_water')).toBe('m³');
		expect(defaultMeterUnit('hot_water')).toBe('m³');
		expect(defaultMeterUnit('heat')).toBe('kWh');
		expect(defaultMeterUnit('gas')).toBe('kWh');
		expect(defaultMeterUnit('electricity')).toBe('kWh');
	});
});

describe('defaultCostPeriod', () => {
	it('takes the calendar year of the invoice date', () => {
		expect(defaultCostPeriod('2025-03-14', '2026-10-20')).toEqual({
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31'
		});
	});

	it('falls back to the last calendar year without an invoice date', () => {
		expect(defaultCostPeriod(null, '2026-10-20')).toEqual({
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31'
		});
	});
});

describe('filterYears', () => {
	it('adds the current year, drops duplicates and sorts newest first', () => {
		expect(filterYears([2024, 2025, 2024], 2026)).toEqual([2026, 2025, 2024]);
		expect(filterYears([2026, 2023], 2026)).toEqual([2026, 2023]);
		expect(filterYears([], 2026)).toEqual([2026]);
	});
});

describe('unitAmountsSummary', () => {
	it('sums the amounts and shows what is left against the item: 400 + 350 of 900 € → 150 € left', () => {
		expect(unitAmountsSummary([40000, 35000], 90000)).toEqual({ sum: 75000, difference: 15000 });
		expect(unitAmountsSummary([], 90000)).toEqual({ sum: 0, difference: 90000 });
		expect(unitAmountsSummary([50000, 50000], 90000)).toEqual({ sum: 100000, difference: -10000 });
	});
});

describe('applyCategoryDefaults', () => {
	const category = { allocationKeyId: 'key-area', billingCircleId: 'circle-house' };
	const choice = {
		allocationKeyId: null,
		billingCircleId: null,
		circleFromCategory: true,
		description: 'Hausreinigung 2025'
	};

	it('takes the key and circle of the category', () => {
		expect(applyCategoryDefaults(choice, category)).toEqual({
			...choice,
			allocationKeyId: 'key-area',
			billingCircleId: 'circle-house'
		});
	});

	it('keeps what the form chose: own key, no circle', () => {
		const own = { ...choice, allocationKeyId: 'key-persons', circleFromCategory: false };
		expect(applyCategoryDefaults(own, category)).toEqual({ ...own, billingCircleId: null });
	});

	it('has no result when neither the form nor the category names a key', () => {
		expect(applyCategoryDefaults(choice, { allocationKeyId: null, billingCircleId: null })).toBe(
			undefined
		);
	});
});

describe('sumByCategory', () => {
	it('sums per category in the order of first appearance: 1.200 + 300 Grundsteuer, 600 Müll', () => {
		expect(
			sumByCategory([
				{ categoryName: 'Grundsteuer', amount: 120000 },
				{ categoryName: 'Müll', amount: 60000 },
				{ categoryName: 'Grundsteuer', amount: 30000 }
			])
		).toEqual([
			{ categoryName: 'Grundsteuer', total: 150000, count: 2 },
			{ categoryName: 'Müll', total: 60000, count: 1 }
		]);
		expect(sumByCategory([])).toEqual([]);
	});
});
