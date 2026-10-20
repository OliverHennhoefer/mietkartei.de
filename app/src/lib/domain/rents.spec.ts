import { describe, expect, it } from 'vitest';
import { monthlyAmounts, rentOn, type RentChange } from './rents';

const changes: RentChange[] = [
	{
		validFrom: '2026-01-15',
		baseRent: 60000,
		operatingCostPrepayment: 15000,
		heatingCostPrepayment: 5000,
		status: 'approved'
	},
	{
		validFrom: '2026-07-01',
		baseRent: 63000,
		operatingCostPrepayment: 15000,
		heatingCostPrepayment: 5000,
		status: 'approved'
	},
	{
		validFrom: '2026-09-01',
		baseRent: 70000,
		operatingCostPrepayment: 15000,
		heatingCostPrepayment: 5000,
		status: 'proposed'
	}
];

const term = { startDate: '2026-01-15', endDate: null };

describe('rentOn', () => {
	it('picks the latest approved change on or before the day', () => {
		expect(rentOn(changes, '2026-01-14')).toBeUndefined();
		expect(rentOn(changes, '2026-01-15')?.baseRent).toBe(60000);
		expect(rentOn(changes, '2026-06-30')?.baseRent).toBe(60000);
		expect(rentOn(changes, '2026-07-01')?.baseRent).toBe(63000);
		expect(rentOn(changes, '2026-10-01')?.baseRent).toBe(63000);
	});
});

describe('monthlyAmounts', () => {
	it('returns the full rent for a full month', () => {
		expect(monthlyAmounts(changes, term, '2026-03')).toEqual({
			baseRent: 60000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			days: 31,
			daysInMonth: 31
		});
	});

	it('prorates the first month by days', () => {
		// 17 of 31 days: 600 × 17/31 = 329,03; 150 × 17/31 = 82,26; 50 × 17/31 = 27,42
		expect(monthlyAmounts(changes, term, '2026-01')).toEqual({
			baseRent: 32903,
			operatingCostPrepayment: 8226,
			heatingCostPrepayment: 2742,
			days: 17,
			daysInMonth: 31
		});
	});

	it('prorates a rent change in the middle of a month', () => {
		const midMonth: RentChange[] = [
			{ ...changes[0], validFrom: '2026-01-01' },
			{ ...changes[1], validFrom: '2026-04-16' }
		];
		// April has 30 days: 15 days at 600 (300,00) + 15 days at 630 (315,00)
		expect(
			monthlyAmounts(midMonth, { startDate: '2026-01-01', endDate: null }, '2026-04')
		).toMatchObject({
			baseRent: 30000 + 31500,
			days: 30
		});
	});

	it('returns nothing outside the lease term', () => {
		expect(monthlyAmounts(changes, { ...term, endDate: '2026-05-31' }, '2026-06').days).toBe(0);
		expect(monthlyAmounts(changes, term, '2025-12').baseRent).toBe(0);
		expect(monthlyAmounts(changes, { ...term, endDate: '2026-05-10' }, '2026-05')).toMatchObject({
			baseRent: 19355,
			days: 10
		});
	});
});
