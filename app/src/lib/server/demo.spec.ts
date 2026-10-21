import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { countUnmatched } from './bank/transactions';
import type { Database } from './db';
import { costItems, leases, properties, tasks, tenants, units } from './db/schema';
import { createDemoData, isEmptyAccount } from './demo';
import { listBalances } from './ledger';
import { contextA, contextB, seedUnit, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

describe('createDemoData', () => {
	it('fills an empty account with properties, leases, payments, transactions and tasks', async () => {
		expect(await isEmptyAccount(db, 'a')).toBe(true);
		const result = await createDemoData(db, contextA);
		expect(result).toEqual({ ok: true, leases: 5 });

		expect(await db.select().from(properties).where(eq(properties.accountId, 'a'))).toHaveLength(2);
		expect(await db.select().from(units).where(eq(units.accountId, 'a'))).toHaveLength(6);
		expect(await db.select().from(tenants).where(eq(tenants.accountId, 'a'))).toHaveLength(5);
		expect(await db.select().from(leases).where(eq(leases.accountId, 'a'))).toHaveLength(5);
		expect(await db.select().from(costItems).where(eq(costItems.accountId, 'a'))).toHaveLength(5);
		expect(await db.select().from(tasks).where(eq(tasks.accountId, 'a'))).toHaveLength(2);
		expect(await countUnmatched(db, 'a')).toBe(3);

		// Only Berger is in arrears, by the two unpaid months before the current one plus the
		// current month (open on the bank account, not booked yet); everyone else owes this month.
		const balances = await listBalances(db, 'a');
		const inArrears = balances.filter((balance) => balance.balance > 0);
		expect(inArrears.length).toBeGreaterThan(0);
		const berger = balances.reduce((max, balance) =>
			balance.balance > max.balance ? balance : max
		);
		expect(berger.balance).toBe(3 * (83000 + 16000 + 7500));
		// The ended lease is settled: no charge after its end, nothing before its ledger start.
		expect(balances.every((balance) => balance.balance >= 0)).toBe(true);

		expect(await isEmptyAccount(db, 'b')).toBe(true);
	});

	it('refuses an account that already has a property', async () => {
		await seedUnit(db, 'a');
		expect(await createDemoData(db, contextA)).toEqual({ ok: false, reason: 'not-empty' });
		expect(await createDemoData(db, contextB)).toMatchObject({ ok: true });
	});
});
