import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database } from './index';
import { chunk, chunkIds, rowsPerStatement, runBatch } from './batch';
import { accounts, properties } from './schema';
import { createSqliteDatabase } from './sqlite';

const address = { street: 'Lindenstraße 4', postalCode: '10115', city: 'Berlin' };

let db: Database;

beforeEach(async () => {
	db = createSqliteDatabase(':memory:');
	await db.insert(accounts).values({ id: 'a', name: 'Konto A' });
});

describe('runBatch', () => {
	it('runs all statements', async () => {
		await runBatch(db, [
			db.insert(properties).values({ accountId: 'a', name: 'Eins', ...address }),
			db.insert(properties).values({ accountId: 'a', name: 'Zwei', ...address }),
			db.update(properties).set({ city: 'Leipzig' }).where(eq(properties.name, 'Eins'))
		]);
		const rows = await db.select().from(properties);
		expect(rows.map((row) => [row.name, row.city]).sort()).toEqual([
			['Eins', 'Leipzig'],
			['Zwei', 'Berlin']
		]);
	});

	it('rolls everything back when one statement fails', async () => {
		await expect(
			runBatch(db, [
				db.insert(properties).values({ accountId: 'a', name: 'Eins', ...address }),
				db.insert(properties).values({ accountId: 'missing', name: 'Zwei', ...address })
			])
		).rejects.toThrow();
		expect(await db.select().from(properties)).toHaveLength(0);
	});

	it('does nothing for an empty list', async () => {
		await runBatch(db, []);
		expect(await db.select().from(properties)).toHaveLength(0);
	});
});

describe('chunk', () => {
	it('splits into groups of the given size', () => {
		expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
		expect(chunk([], 2)).toEqual([]);
	});
});

describe('rowsPerStatement', () => {
	it('keeps rows × columns below the 100 bound parameters of D1', async () => {
		const { bankTransactions, leaseTenants } = await import('./schema');
		const columns = Object.keys(bankTransactions).length;
		expect(rowsPerStatement(bankTransactions) * columns).toBeLessThanOrEqual(100);
		expect(rowsPerStatement(leaseTenants)).toBe(50);
	});
});

describe('chunkIds', () => {
	it('splits ids into groups that stay below the parameter limit', () => {
		const ids = Array.from({ length: 200 }, (_, index) => `id-${index}`);
		expect(chunkIds(ids).map((group) => group.length)).toEqual([90, 90, 20]);
	});
});
