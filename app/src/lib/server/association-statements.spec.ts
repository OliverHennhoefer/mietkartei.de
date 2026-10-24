import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import {
	createAssociationStatement,
	deleteAssociationStatement,
	getAssociationStatement,
	listAssociationStatements,
	updateAssociationStatement,
	type AssociationStatementInput
} from './association-statements';
import { auditLog, expenses } from './db/schema';
import { contextA, contextB, seedCostItem, seedUnit, testDatabase } from './testing';

let db: Database;
let propertyId: string;
let unitId: string;

beforeEach(async () => {
	db = await testDatabase();
	({ propertyId, unitId } = await seedUnit(db, 'a'));
});

function input(overrides: Partial<AssociationStatementInput> = {}): AssociationStatementInput {
	return {
		periodStart: '2025-01-01',
		periodEnd: '2025-12-31',
		allocableCosts: 180000,
		nonAllocableCosts: 60000,
		reserveContribution: 40000,
		reserveWithdrawal: 0,
		feesDue: 300000,
		statedBalance: -20000,
		note: null,
		...overrides
	};
}

async function fee(date: string, amount: number, scope: { propertyId?: string; unitId?: string }) {
	await db.insert(expenses).values({
		accountId: 'a',
		propertyId: scope.propertyId ?? propertyId,
		unitId: scope.unitId ?? null,
		date,
		amount,
		category: 'association_fee',
		description: 'Hausgeld'
	});
}

describe('association statements', () => {
	it('reconciles against the Hausgeld paid and the Belege with WEG figures', async () => {
		const created = await createAssociationStatement(db, contextA, propertyId, input());
		if (!created.ok) throw new Error(created.reason);
		// Eleven months on the property, one on its unit; one of 2024 and a repair do not count.
		for (let month = 1; month <= 11; month += 1) {
			await fee(`2025-${String(month).padStart(2, '0')}-01`, 25000, {});
		}
		await fee('2025-12-01', 25000, { unitId });
		await fee('2024-12-01', 25000, {});
		await db.insert(expenses).values({
			accountId: 'a',
			propertyId,
			date: '2025-05-05',
			amount: 9900,
			category: 'maintenance',
			description: 'Reparatur'
		});
		await seedCostItem(db, 'a', propertyId, {
			amount: 150000,
			associationTotal: 1764706,
			associationKey: 'MEA',
			associationKeyTotal: 1000,
			associationKeyShare: 85
		});
		// A Beleg without WEG figures (Grundsteuer) does not count.
		await seedCostItem(db, 'a', propertyId, { amount: 30000 });

		const statement = (await getAssociationStatement(db, 'a', created.id))!;
		expect(statement).toMatchObject({
			costsTotal: 280000,
			feesPaid: 300000,
			feesOutstanding: 0,
			settlement: -20000,
			balanceDifference: 0,
			allocableRecorded: 150000,
			allocableMissing: 30000
		});
		expect(statement.findings.map((finding) => finding.code)).toEqual(['allocable']);
		expect(await listAssociationStatements(db, 'b')).toEqual([]);
		expect(await getAssociationStatement(db, 'b', created.id)).toBeUndefined();
	});

	it('refuses a second statement for the same year and a property of another account', async () => {
		expect((await createAssociationStatement(db, contextA, propertyId, input())).ok).toBe(true);
		expect(await createAssociationStatement(db, contextA, propertyId, input())).toEqual({
			ok: false,
			reason: 'duplicate-period'
		});
		expect(await createAssociationStatement(db, contextB, propertyId, input())).toEqual({
			ok: false,
			reason: 'unknown-property'
		});
	});

	it('updates and deletes with an audit line each, only in its own account', async () => {
		const created = await createAssociationStatement(db, contextA, propertyId, input());
		if (!created.ok) throw new Error(created.reason);
		const next = await createAssociationStatement(
			db,
			contextA,
			propertyId,
			input({ periodStart: '2026-01-01', periodEnd: '2026-12-31' })
		);
		if (!next.ok) throw new Error(next.reason);
		expect(
			await updateAssociationStatement(db, contextA, next.id, input({ feesDue: 320000 }))
		).toEqual({ ok: false, reason: 'duplicate-period' });
		expect(
			await updateAssociationStatement(db, contextB, created.id, input({ feesDue: 320000 }))
		).toEqual({ ok: false, reason: 'missing' });
		expect(
			await updateAssociationStatement(db, contextA, created.id, input({ feesDue: 320000 }))
		).toEqual({ ok: true });
		expect((await getAssociationStatement(db, 'a', created.id))?.feesDue).toBe(320000);
		expect(await deleteAssociationStatement(db, contextB, created.id)).toBe(false);
		expect(await deleteAssociationStatement(db, contextA, created.id)).toBe(true);
		expect((await listAssociationStatements(db, 'a', propertyId)).map((row) => row.id)).toEqual([
			next.id
		]);
		const actions = await db
			.select({ action: auditLog.action })
			.from(auditLog)
			.where(and(eq(auditLog.accountId, 'a'), eq(auditLog.entity, 'association_statement')));
		expect(actions.map((row) => row.action).sort()).toEqual([
			'create',
			'create',
			'delete',
			'update'
		]);
	});
});
