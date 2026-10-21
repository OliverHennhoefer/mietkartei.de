import { describe, expect, it } from 'vitest';
import { laterRowUpdates, rentOn, type RentChange } from './rents';

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

describe('rentOn', () => {
	it('picks the latest approved change on or before the day', () => {
		expect(rentOn(changes, '2026-01-14')).toBeUndefined();
		expect(rentOn(changes, '2026-01-15')?.baseRent).toBe(60000);
		expect(rentOn(changes, '2026-06-30')?.baseRent).toBe(60000);
		expect(rentOn(changes, '2026-07-01')?.baseRent).toBe(63000);
		expect(rentOn(changes, '2026-10-01')?.baseRent).toBe(63000);
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
