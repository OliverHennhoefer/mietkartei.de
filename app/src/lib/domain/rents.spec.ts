import { describe, expect, it } from 'vitest';
import { laterRowUpdates, monthlyAmounts, rentOn, type RentChange } from './rents';

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

describe('monthlyAmounts with an unchanged field', () => {
	it('keeps a prepayment that does not change exact when another field changes mid-month', () => {
		// April has 30 days; the base rent changes on 16 April, the prepayments stay at 123,45 € and
		// 50,01 €. Rounded per stretch, 12345 × 15/30 = 6172,5 → 6173 twice = 12346 and 5001 → 5002;
		// rounded once over the month they stay 12345 and 5001.
		const history: RentChange[] = [
			{
				validFrom: '2026-01-01',
				baseRent: 60000,
				operatingCostPrepayment: 12345,
				heatingCostPrepayment: 5001,
				status: 'approved'
			},
			{
				validFrom: '2026-04-16',
				baseRent: 63001,
				operatingCostPrepayment: 12345,
				heatingCostPrepayment: 5001,
				status: 'approved'
			}
		];
		expect(monthlyAmounts(history, { startDate: '2026-01-01', endDate: null }, '2026-04')).toEqual({
			// 60000 × 15/30 + 63001 × 15/30 = 30000 + 31500,5 = 61500,5 → 61501.
			baseRent: 61501,
			operatingCostPrepayment: 12345,
			heatingCostPrepayment: 5001,
			days: 30,
			daysInMonth: 30
		});
	});
});

describe('laterRowUpdates', () => {
	const row = (
		id: string,
		validFrom: string,
		baseRent: number,
		operatingCostPrepayment: number,
		status: 'approved' | 'proposed' = 'approved'
	) => ({ id, validFrom, baseRent, operatingCostPrepayment, heatingCostPrepayment: 5000, status });

	it('carries a new prepayment into later rows that inherited the old one', () => {
		// Staffel steps entered up front for 2027 and 2028 copied the prepayment of 150 €; a § 560
		// change from 2026-06-01 raises it to 200 €. Both steps follow; their Kaltmiete stays.
		const history = [
			row('initial', '2025-01-01', 60000, 15000),
			row('step-2027', '2027-01-01', 62000, 15000),
			row('step-2028', '2028-01-01', 64000, 15000)
		];
		expect(
			laterRowUpdates(
				history,
				'2026-06-01',
				{ baseRent: 60000, operatingCostPrepayment: 15000, heatingCostPrepayment: 5000 },
				{ baseRent: 60000, operatingCostPrepayment: 20000, heatingCostPrepayment: 5000 }
			)
		).toEqual([
			{ field: 'operatingCostPrepayment', value: 20000, ids: ['step-2027', 'step-2028'] }
		]);
	});

	it('stops at the first later row that set the field itself and ignores proposals', () => {
		const history = [
			row('initial', '2025-01-01', 60000, 15000),
			row('proposal', '2026-08-01', 61000, 15000, 'proposed'),
			row('step-2027', '2027-01-01', 62000, 15000),
			// A later § 560 change set 180 €; it and what follows keep their own value.
			row('statement-2027', '2027-06-01', 62000, 18000),
			row('step-2028', '2028-01-01', 64000, 18000)
		];
		expect(
			laterRowUpdates(
				history,
				'2026-06-01',
				{ baseRent: 60000, operatingCostPrepayment: 15000, heatingCostPrepayment: 5000 },
				{ baseRent: 60000, operatingCostPrepayment: 20000, heatingCostPrepayment: 5000 }
			)
		).toEqual([{ field: 'operatingCostPrepayment', value: 20000, ids: ['step-2027'] }]);
	});

	it('carries a new Kaltmiete into a later § 560 row and skips the excluded row', () => {
		// A § 560 row from 2027-03-01 copied the Kaltmiete of 600 €; a Staffel step on 2027-01-01
		// to 620 € must reach it. The excluded id is the row being edited itself.
		const history = [
			row('initial', '2025-01-01', 60000, 15000),
			row('statement', '2027-03-01', 60000, 20000)
		];
		expect(
			laterRowUpdates(
				history,
				'2027-01-01',
				{ baseRent: 60000, operatingCostPrepayment: 15000, heatingCostPrepayment: 5000 },
				{ baseRent: 62000, operatingCostPrepayment: 15000, heatingCostPrepayment: 5000 }
			)
		).toEqual([{ field: 'baseRent', value: 62000, ids: ['statement'] }]);
		expect(
			laterRowUpdates(
				history,
				'2025-01-01',
				{ baseRent: 60000, operatingCostPrepayment: 15000, heatingCostPrepayment: 5000 },
				{ baseRent: 61000, operatingCostPrepayment: 15000, heatingCostPrepayment: 5000 },
				'statement'
			)
		).toEqual([]);
	});
});
