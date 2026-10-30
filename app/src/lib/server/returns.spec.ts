import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { expenses, taxYears } from './db/schema';
import { loadReturns } from './returns';
import { seedUnit, testDatabase } from './testing';

// The rows behind Rendite und Cashflow: the years of the window select and the interest of the
// Steuer tab handed to the domain.

let db: Database;
let propertyId: string;

beforeEach(async () => {
	db = await testDatabase();
	({ propertyId } = await seedUnit(db, 'a', { name: 'EG', propertyName: 'Haus' }));
});

function rate(date: string) {
	return {
		accountId: 'a',
		date,
		amount: 1000_00,
		category: 'loan_payment' as const,
		propertyId,
		description: 'Darlehensrate'
	};
}

describe('loadReturns', () => {
	it('offers every year back to the oldest booking, newest first', async () => {
		await db.insert(expenses).values(rate('2023-03-01'));
		const result = await loadReturns(db, 'a', {
			window: 2026,
			propertyId: null,
			today: '2026-05-10'
		});
		expect(result.years).toEqual([2026, 2025, 2024, 2023]);
	});

	it('leaves a rate unsplit when the Steuer tab has the year without its interest', async () => {
		await db.insert(expenses).values(rate('2025-06-01'));
		await db
			.insert(taxYears)
			.values({ accountId: 'a', propertyId, year: 2025, loanInterest: null });
		const result = await loadReturns(db, 'a', {
			window: 2025,
			propertyId: null,
			today: '2026-05-10'
		});
		expect(result.properties[0]).toMatchObject({ interest: 0, repayment: 0, unsplit: 1000_00 });
	});
});
