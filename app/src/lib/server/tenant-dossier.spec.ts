import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import {
	depositTransactions,
	operatingCostStatements,
	rentCharges,
	statementResults
} from './db/schema';
import { createExpense } from './expenses';
import { listLeases } from './leases';
import { createPayment } from './ledger';
import { tenantDossier } from './tenant-dossier';
import { contextA, contextB, seedLease, seedTenant, seedUnit, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

async function dossierOf(tenantId: string, accountId = 'a') {
	const leases = await listLeases(db, accountId, { tenantId });
	return tenantDossier(db, accountId, tenantId, leases, '2025-03-15');
}

describe('tenantDossier', () => {
	it('sums money, statements and the costs on the unit over the tenancy', async () => {
		const tenantId = await seedTenant(db, 'a');
		const { unitId, propertyId } = await seedUnit(db, 'a');
		// January to March at 800 €, due on the 3rd.
		const leaseId = await seedLease(db, 'a', unitId, {
			tenantIds: [tenantId],
			endDate: '2025-03-31'
		});
		await createPayment(db, contextA, {
			leaseId,
			date: '2025-01-03',
			amount: 80000,
			source: 'manual'
		});
		await createPayment(db, contextA, {
			leaseId,
			date: '2025-02-03',
			amount: 80000,
			source: 'manual'
		});
		await db.insert(depositTransactions).values({
			accountId: 'a',
			leaseId,
			date: '2025-01-02',
			kind: 'received',
			amount: 120000
		});
		// 2023: approved, then corrected by version 2, whose claim of 140 € includes 20 € unpaid
		// prepayments already charged as rent, so it posts 120 €. 2024: a claim of 30 € taken back
		// because the statement reached the tenant too late.
		const statement = async (
			periodStart: string,
			version: number,
			correctsId: string | null,
			claim: number
		) => {
			const [row] = await db
				.insert(operatingCostStatements)
				.values({
					accountId: 'a',
					propertyId,
					periodStart,
					periodEnd: periodStart.replace('-01-01', '-12-31'),
					version,
					status: 'approved',
					correctsId
				})
				.returning({ id: operatingCostStatements.id });
			await db.insert(statementResults).values({
				accountId: 'a',
				statementId: row.id,
				leaseId,
				balance: claim,
				result: JSON.stringify({ posted: claim })
			});
			return row.id;
		};
		const charge = (referenceId: string, amount: number, reversesChargeId: string | null = null) =>
			db
				.insert(rentCharges)
				.values({
					accountId: 'a',
					leaseId,
					period: '2025-02',
					dueDate: '2025-02-28',
					kind: 'statement_balance',
					referenceId,
					reversesChargeId,
					amount
				})
				.returning({ id: rentCharges.id })
				.then(([row]) => row.id);
		const first = await statement('2023-01-01', 1, null, -5000);
		const firstCharge = await charge(first, -5000);
		const second = await statement('2023-01-01', 2, first, 14000);
		await charge(second, 5000, firstCharge);
		await charge(second, 12000);
		const late = await statement('2024-01-01', 1, null, 3000);
		await charge(late, -3000, await charge(late, 3000));
		const expense = (
			date: string,
			category: 'maintenance' | 'loan_interest',
			scope: 'unit' | 'property'
		) =>
			createExpense(db, contextA, {
				date,
				amount: 30000,
				category,
				description: 'Therme',
				scope: { kind: scope, id: scope === 'unit' ? unitId : propertyId }
			});
		await expense('2025-02-10', 'maintenance', 'unit');
		await expense('2025-02-11', 'loan_interest', 'unit');
		await expense('2025-02-12', 'maintenance', 'property');
		await expense('2025-05-01', 'maintenance', 'unit');

		const dossier = await dossierOf(tenantId);

		expect(dossier.finances).toMatchObject({
			charged: 240000 + 12000,
			paid: 160000,
			balance: 92000,
			overdue: 92000,
			openSince: '2025-02',
			lastPaymentDate: '2025-02-03',
			statementBalance: 14000,
			unitCosts: 30000,
			net: 130000,
			depositHeld: 120000,
			// The lease has ended, so what was never paid in is not shown as open any more.
			depositOutstanding: 0
		});
		expect(dossier.statements).toEqual([
			{ statementId: late, leaseId, label: 'Betriebskostenabrechnung 2024', amount: 0 },
			{ statementId: second, leaseId, label: 'Betriebskostenabrechnung 2023', amount: 14000 }
		]);
		expect(dossier.unitCosts.map((cost) => cost.date)).toEqual(['2025-02-10']);
		expect(dossier.payments.map((payment) => payment.date)).toEqual(['2025-02-03', '2025-01-03']);
		expect(dossier.leases).toEqual([
			expect.objectContaining({ id: leaseId, rent: 80000, depositHeld: 120000 })
		]);
		expect(dossier.history.length).toBeGreaterThan(0);
	});

	it('works for a tenant without a lease and sees nothing of another account', async () => {
		const tenantId = await seedTenant(db, 'a');
		const foreignTenant = await seedTenant(db, 'b');
		const { unitId } = await seedUnit(db, 'b');
		const leaseId = await seedLease(db, 'b', unitId, { tenantIds: [foreignTenant] });
		await createPayment(db, contextB, {
			leaseId,
			date: '2025-01-03',
			amount: 80000,
			source: 'manual'
		});

		const dossier = await dossierOf(tenantId);
		expect(dossier.leases).toEqual([]);
		expect(dossier.finances).toMatchObject({ charged: 0, paid: 0, overdue: 0 });
		expect(dossier.payments).toEqual([]);
		expect(dossier.documents).toEqual([]);
		expect((await dossierOf(foreignTenant)).leases).toEqual([]);
	});
});
