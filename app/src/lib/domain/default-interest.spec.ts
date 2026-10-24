import { describe, expect, it } from 'vitest';
import { baseRateOn, defaultInterest, formatRate, halfYearStart } from './default-interest';

const rates = [
	{ validFrom: '2025-01-01', rate: 227 },
	{ validFrom: '2025-07-01', rate: 127 },
	{ validFrom: '2026-01-01', rate: 127 },
	{ validFrom: '2026-07-01', rate: 152 }
];

const item = (dueDate: string, open: number) => ({ label: 'Miete', dueDate, amount: open, open });

describe('halfYearStart and baseRateOn', () => {
	it('finds the half-year and its rate', () => {
		expect(halfYearStart('2026-06-30')).toBe('2026-01-01');
		expect(halfYearStart('2026-07-01')).toBe('2026-07-01');
		expect(baseRateOn(rates, '2026-10-24')?.rate).toBe(152);
		expect(baseRateOn(rates, '2024-12-31')).toBeUndefined();
	});
});

describe('defaultInterest', () => {
	it('charges five points above the Basiszinssatz from the day after the due date', () => {
		// 1.000 € due 3 March 2026, 30 days to 2 April at 6,27 %: 1000 × 6,27 % × 30 / 365 = 5,15 €.
		const result = defaultInterest([item('2026-03-03', 100000)], rates, '2026-04-02');
		expect(result.amount).toBe(515);
		expect(result.periods).toEqual([{ validFrom: '2026-01-01', baseRate: 127, interestRate: 627 }]);
		expect(result.uncoveredDays).toBe(0);
	});

	it('changes the rate on 1 July', () => {
		// 1 June to 30 June at 6,27 % (30 days), 1 to 31 July at 6,52 % (31 days).
		const result = defaultInterest([item('2026-05-31', 100000)], rates, '2026-07-31');
		expect(result.amount).toBe(Math.round((100000 * (627 * 30 + 652 * 31)) / (10000 * 365)));
		expect(result.periods.map((period) => period.interestRate)).toEqual([627, 652]);
	});

	it('adds up the items and leaves out those not overdue yet', () => {
		const result = defaultInterest(
			[item('2026-03-03', 100000), item('2026-04-02', 100000)],
			rates,
			'2026-04-02'
		);
		expect(result.amount).toBe(515);
		expect(defaultInterest([], rates, '2026-04-02').amount).toBe(0);
	});

	it('counts the days before the first known rate as uncovered', () => {
		const result = defaultInterest([item('2024-12-21', 100000)], rates, '2025-01-10');
		expect(result.uncoveredDays).toBe(10);
		expect(result.amount).toBe(Math.round((100000 * 727 * 10) / (10000 * 365)));
	});
});

describe('formatRate', () => {
	it('writes basis points as a German percentage', () => {
		expect(formatRate(152)).toBe('1,52 %');
		expect(formatRate(-88)).toBe('-0,88 %');
	});
});
