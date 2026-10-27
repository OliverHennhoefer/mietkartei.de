import { describe, expect, it } from 'vitest';
import { depositInstalments, type InstalmentLease } from './deposit';

// 1.800 € from 2025-01-01, rent due on the third working day.
const lease: InstalmentLease = {
	kind: 'residential',
	startDate: '2025-01-01',
	rentDueDay: 3,
	securityDeposit: 180000,
	state: null
};

describe('depositInstalments', () => {
	it('puts the three instalments on the first three rent due dates', () => {
		// Third working days: Mon 6 Jan (Neujahr does not count), Wed 5 Feb, Wed 5 Mar 2025;
		// 1.800 € / 3 = 600 € each.
		expect(depositInstalments(lease)).toEqual([
			{ dueDate: '2025-01-06', amount: 60000 },
			{ dueDate: '2025-02-05', amount: 60000 },
			{ dueDate: '2025-03-05', amount: 60000 }
		]);
	});

	it('splits an odd deposit to the cent and keeps the first one at the start', () => {
		// Third working days: Wed 5 Jun, Wed 3 Jul, Mon 5 Aug 2024. The first instalment is due at
		// the start of the tenancy (§ 551 Abs. 2 BGB), so 5 June becomes the start date, 15 June.
		// 1.000,00 € over three: 333,34 + 333,33 + 333,33 (largest remainder, first index wins).
		expect(
			depositInstalments({ ...lease, startDate: '2024-06-15', securityDeposit: 100000 })
		).toEqual([
			{ dueDate: '2024-06-15', amount: 33334 },
			{ dueDate: '2024-07-03', amount: 33333 },
			{ dueDate: '2024-08-05', amount: 33333 }
		]);
	});

	it('uses the holidays of the property’s Bundesland', () => {
		// 6 January is a holiday in Bavaria: Tue 7 Jan is the third working day.
		expect(depositInstalments({ ...lease, state: 'BY' })[0].dueDate).toBe('2025-01-07');
	});

	it('is empty for commercial leases and leases without a deposit', () => {
		expect(depositInstalments({ ...lease, kind: 'commercial' })).toEqual([]);
		expect(depositInstalments({ ...lease, kind: 'parking' })).toEqual([]);
		expect(depositInstalments({ ...lease, securityDeposit: 0 })).toEqual([]);
	});
});
