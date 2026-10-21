import { describe, expect, it } from 'vitest';
import {
	diffCharges,
	expectedRentCharges,
	type ChargeTerm,
	type ExpectedCharge,
	type StoredCharge
} from './charges';
import type { RentChange } from './rents';

// A lease from 15 January 2025 at 600 € + 150 € + 50 €, raised to 650 € from April.
const lease = { startDate: '2025-01-15', endDate: null, ledgerStart: null, rentDueDay: 3 };

const changes: RentChange[] = [
	{
		validFrom: '2025-01-15',
		baseRent: 60000,
		operatingCostPrepayment: 15000,
		heatingCostPrepayment: 5000,
		status: 'approved'
	},
	{
		validFrom: '2025-04-01',
		baseRent: 65000,
		operatingCostPrepayment: 15000,
		heatingCostPrepayment: 5000,
		status: 'approved'
	}
];

// January has 31 days, 17 of them rented: 600 × 17/31 = 329,03; 150 × 17/31 = 82,26 (82,258
// rounded up); 50 × 17/31 = 27,42 (27,419). Together 438,71.
const january: ExpectedCharge = {
	period: '2025-01',
	// The third working day is Mon 6 (Wed 1 is Neujahr), before the lease starts: due on the 15th.
	dueDate: '2025-01-15',
	baseRent: 32903,
	operatingCostPrepayment: 8226,
	heatingCostPrepayment: 2742,
	amount: 43871
};

const full = (period: string, dueDate: string, baseRent: number): ExpectedCharge => ({
	period,
	dueDate,
	baseRent,
	operatingCostPrepayment: 15000,
	heatingCostPrepayment: 5000,
	amount: baseRent + 20000
});

// Sat 1, Sun 2, Mon 3, Tue 4, Wed 5
const february = full('2025-02', '2025-02-05', 60000);
// Sat 1, Sun 2, Mon 3, Tue 4, Wed 5
const march = full('2025-03', '2025-03-05', 60000);
// Tue 1, Wed 2, Thu 3
const april = full('2025-04', '2025-04-03', 65000);
// Thu 1 is Tag der Arbeit: Fri 2, Mon 5, Tue 6
const may = full('2025-05', '2025-05-06', 65000);

describe('expectedRentCharges', () => {
	it('charges every month from the start, prorating the first and following the rent history', () => {
		expect(expectedRentCharges(lease, changes, '2025-05')).toEqual([
			january,
			february,
			march,
			april,
			may
		]);
	});

	it('starts at the ledger start when the lease was entered late', () => {
		expect(
			expectedRentCharges({ ...lease, ledgerStart: '2025-03-01' }, changes, '2025-05')
		).toEqual([march, april, may]);
		// A ledger start in the middle of a month prorates that month: 22 of 31 days in March.
		// 600 × 22/31 = 425,81; 150 × 22/31 = 106,45; 50 × 22/31 = 35,48; together 567,74.
		expect(
			expectedRentCharges({ ...lease, ledgerStart: '2025-03-10' }, changes, '2025-03')
		).toEqual([
			{
				period: '2025-03',
				// The third working day, Wed 5, lies before the ledger start.
				dueDate: '2025-03-10',
				baseRent: 42581,
				operatingCostPrepayment: 10645,
				heatingCostPrepayment: 3548,
				amount: 56774
			}
		]);
		// A ledger start before the lease begins changes nothing.
		expect(
			expectedRentCharges({ ...lease, ledgerStart: '2024-06-01' }, changes, '2025-02')
		).toEqual([january, february]);
		// A ledger start after the end charges nothing.
		expect(
			expectedRentCharges(
				{ ...lease, endDate: '2025-05-31', ledgerStart: '2025-06-01' },
				changes,
				'2025-08'
			)
		).toEqual([]);
	});

	it('ends with a prorated last month and nothing after the end date', () => {
		// 10 of 31 days in May at 650 €: 209,68 (209,677); 150 × 10/31 = 48,39; 50 × 10/31 = 16,13.
		expect(expectedRentCharges({ ...lease, endDate: '2025-05-10' }, changes, '2025-08')).toEqual([
			january,
			february,
			march,
			april,
			{
				period: '2025-05',
				dueDate: '2025-05-06',
				baseRent: 20968,
				operatingCostPrepayment: 4839,
				heatingCostPrepayment: 1613,
				amount: 27420
			}
		]);
	});

	it('stops at untilMonth and returns nothing before the lease starts', () => {
		expect(expectedRentCharges(lease, changes, '2025-01')).toEqual([january]);
		expect(expectedRentCharges(lease, changes, '2024-12')).toEqual([]);
	});

	it('ignores proposed changes and skips months before the first approved one', () => {
		const proposed: RentChange = { ...changes[1], validFrom: '2025-05-01', baseRent: 70000 };
		expect(
			expectedRentCharges(lease, [...changes, { ...proposed, status: 'proposed' }], '2025-05')
		).toEqual([january, february, march, april, may]);

		expect(expectedRentCharges(lease, [{ ...changes[0], status: 'proposed' }], '2025-05')).toEqual(
			[]
		);
		// The initial rent is only known from March: January and February have no charge.
		expect(
			expectedRentCharges(
				lease,
				[{ ...changes[0], validFrom: '2025-03-01' }, changes[1]],
				'2025-04'
			)
		).toEqual([march, april]);
	});

	it('uses the n-th working day of the lease as due date', () => {
		// January: Neujahr, so Thu 2. February: Sat 1, Sun 2, Mon 3.
		expect(
			expectedRentCharges(
				{ ...lease, startDate: '2025-01-01', rentDueDay: 1 },
				[{ ...changes[0], validFrom: '2025-01-01' }],
				'2025-02'
			).map((c) => c.dueDate)
		).toEqual(['2025-01-02', '2025-02-03']);
	});

	it('makes the first rent due no earlier than the start of the lease or the ledger', () => {
		// The lease starts on Wed 15 January, after the third working day (Mon 6): due on the 15th.
		// A start before the due day keeps the working day: from Fri 3 January, due Mon 6.
		const dueDates = (term: ChargeTerm) =>
			expectedRentCharges(term, [{ ...changes[0], validFrom: '2025-01-01' }], '2025-02').map(
				(c) => c.dueDate
			);
		expect(dueDates(lease)).toEqual(['2025-01-15', '2025-02-05']);
		expect(dueDates({ ...lease, startDate: '2025-01-03' })).toEqual(['2025-01-06', '2025-02-05']);
		// Same for a ledger start in the middle of a month: from 20 February, due on the 20th.
		expect(dueDates({ ...lease, ledgerStart: '2025-02-20' })).toEqual(['2025-02-20']);
	});

	it('moves the due date past a public holiday', () => {
		// October 2025: Wed 1, Thu 2, Fri 3 is Tag der Deutschen Einheit, so Mon 6.
		expect(
			expectedRentCharges({ ...lease, endDate: '2025-10-31' }, changes, '2025-10')
				.slice(-1)
				.map((c) => c.dueDate)
		).toEqual(['2025-10-06']);
	});
});

describe('diffCharges', () => {
	const stored = (charge: ExpectedCharge, id: string): StoredCharge => ({ ...charge, id });

	it('inserts months without a row', () => {
		expect(diffCharges([stored(january, 'jan')], [january, february])).toEqual({
			insert: [february],
			update: [],
			remove: []
		});
	});

	it('updates rows whose amounts or due date differ, keeping their id', () => {
		const stale = stored({ ...february, baseRent: 55000, amount: 75000 }, 'feb');
		const lateDue = stored({ ...march, dueDate: '2025-03-03' }, 'mar');
		expect(diffCharges([stale, lateDue], [february, march])).toEqual({
			insert: [],
			update: [
				{ ...february, id: 'feb' },
				{ ...march, id: 'mar' }
			],
			remove: []
		});
	});

	it('removes rows for months that are no longer expected', () => {
		expect(
			diffCharges(
				[stored(january, 'jan'), stored(february, 'feb'), stored(march, 'mar')],
				[february]
			)
		).toEqual({ insert: [], update: [], remove: ['jan', 'mar'] });
	});

	it('changes nothing when the rows already match', () => {
		expect(
			diffCharges([stored(january, 'jan'), stored(february, 'feb')], [january, february])
		).toEqual({ insert: [], update: [], remove: [] });
	});
});
