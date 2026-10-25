import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { expenses, operatingCostStatements, statementResults } from './db/schema';
import { loadForecast } from './forecast';
import { seedLease, seedUnit, testDatabase } from './testing';

// The rows behind the Prognose: one lease, its expenses and the approved statements of 2025,
// first and corrected version.

let db: Database;
let propertyId: string;
let leaseId: string;

beforeEach(async () => {
	db = await testDatabase();
	const unit = await seedUnit(db, 'a', { name: 'EG', propertyName: 'Haus' });
	propertyId = unit.propertyId;
	leaseId = await seedLease(db, 'a', unit.unitId, { startDate: '2024-01-01' });
});

async function statement(version: number, costs: number) {
	const [row] = await db
		.insert(operatingCostStatements)
		.values({
			accountId: 'a',
			propertyId,
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			version,
			status: 'approved'
		})
		.returning();
	await db.insert(statementResults).values({
		accountId: 'a',
		statementId: row.id,
		leaseId,
		balance: 100_00,
		result: JSON.stringify({ costsTotal: costs, occupancy: { days: 365 } })
	});
}

describe('loadForecast', () => {
	it('takes the latest version of the latest statement and the costs of the last year', async () => {
		await statement(1, 2000_00);
		await statement(2, 3650_00);
		await db.insert(expenses).values({
			accountId: 'a',
			date: '2026-02-10',
			amount: 1200_00,
			category: 'maintenance',
			propertyId,
			description: 'Therme'
		});
		const result = await loadForecast(db, 'a', { propertyId: null, today: '2026-03-15' });
		expect(result.monthlyCosts).toBe(100_00);
		expect(result.settlements).toEqual([
			expect.objectContaining({ leaseId, lastBalance: 100_00, yearlyCosts: 3650_00 })
		]);
		expect(result.settlements[0].label).toContain('EG · Haus');
		expect(result.propertyOptions).toEqual([{ id: propertyId, name: 'Haus' }]);
	});
});
