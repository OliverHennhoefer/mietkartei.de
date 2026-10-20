import { describe, expect, it } from 'vitest';
import {
	DEGREE_DAYS_PER_YEAR,
	degreeDayShares,
	degreeDays,
	splitByDegreeDays
} from './degree-days';

describe('degreeDayShares', () => {
	it('add up to 1000', () => {
		expect(degreeDayShares.reduce((sum, share) => sum + share, 0)).toBe(DEGREE_DAYS_PER_YEAR);
	});
});

describe('degreeDays', () => {
	it('gives 1000 for a calendar year, also a leap year', () => {
		expect(degreeDays({ start: '2025-01-01', end: '2025-12-31' })).toBeCloseTo(1000, 9);
		expect(degreeDays({ start: '2024-01-01', end: '2024-12-31' })).toBeCloseTo(1000, 9);
	});

	it('sums whole months exactly', () => {
		// Jan–Aug: 170 + 150 + 130 + 80 + 40 + 13 + 13 + 14 = 610; Sep–Dec: 30 + 80 + 120 + 160 = 390.
		expect(degreeDays({ start: '2025-01-01', end: '2025-08-31' })).toBeCloseTo(610, 9);
		expect(degreeDays({ start: '2025-09-01', end: '2025-12-31' })).toBeCloseTo(390, 9);
	});

	it('prorates a partial month by its days', () => {
		// 16 of 31 January days: 170 × 16 / 31 = 87,74…
		expect(degreeDays({ start: '2025-01-01', end: '2025-01-16' })).toBeCloseTo((170 * 16) / 31, 9);
		// Rest of January plus all of February: 170 × 15 / 31 + 150.
		expect(degreeDays({ start: '2025-01-17', end: '2025-02-28' })).toBeCloseTo(
			(170 * 15) / 31 + 150,
			9
		);
	});

	it('is 0 for an empty range', () => {
		expect(degreeDays({ start: '2025-03-02', end: '2025-03-01' })).toBe(0);
	});
});

describe('splitByDegreeDays', () => {
	it('splits a quantity between two ranges by their degree days', () => {
		// 200 kWh over Jan–Aug (610) and Sep–Dec (390): 122 and 78.
		const [first, second] = splitByDegreeDays(200, [
			{ start: '2025-01-01', end: '2025-08-31' },
			{ start: '2025-09-01', end: '2025-12-31' }
		]);
		expect(first).toBeCloseTo(122, 9);
		expect(second).toBeCloseTo(78, 9);
	});

	it('gives zeros when the ranges have no degree days', () => {
		expect(splitByDegreeDays(100, [{ start: '2025-03-02', end: '2025-03-01' }])).toEqual([0]);
		expect(splitByDegreeDays(100, [])).toEqual([]);
	});
});
