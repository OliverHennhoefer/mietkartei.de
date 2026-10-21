import type { Database } from './db';
import { accounts, leaseTenants, leases, tenants, users } from './db/schema';
import { createSqliteDatabase } from './db/sqlite';

// Fixtures for unit tests of server modules: an in-memory database with two accounts (`a` and
// `b`), one owner each, and helpers that create the rows most tests need. Everything a test
// creates in account `b` exists only to prove it does not leak into account `a`.

export const address = { street: 'Lindenstraße 4', postalCode: '10115', city: 'Berlin' };

export const contextA = { accountId: 'a', userId: 'user-a' };
export const contextB = { accountId: 'b', userId: 'user-b' };

/** A fresh in-memory database with accounts `a` and `b` and one owner each. */
export async function testDatabase(): Promise<Database> {
	const db = createSqliteDatabase(':memory:');
	await db.insert(accounts).values([
		{ id: 'a', name: 'Konto A' },
		{ id: 'b', name: 'Konto B' }
	]);
	await db.insert(users).values([
		{ id: 'user-a', accountId: 'a', email: 'a@example.org', passwordHash: 'x' },
		{ id: 'user-b', accountId: 'b', email: 'b@example.org', passwordHash: 'x' }
	]);
	return db;
}

export async function seedTenant(
	db: Database,
	accountId: string,
	overrides: Partial<typeof tenants.$inferInsert> = {}
) {
	const [tenant] = await db
		.insert(tenants)
		.values({ firstName: 'Erika', lastName: 'Mustermann', ...overrides, accountId })
		.returning({ id: tenants.id });
	return tenant.id;
}

/** A plain lease of the unit from 2025-01-01 at 600 € + 150 €, with the given tenants. */
export async function seedLease(
	db: Database,
	accountId: string,
	unitId: string,
	overrides: Partial<typeof leases.$inferInsert> & { tenantIds?: string[] } = {}
) {
	const { tenantIds = [], ...lease } = overrides;
	const [row] = await db
		.insert(leases)
		.values({
			startDate: '2025-01-01',
			baseRent: 60000,
			operatingCostPrepayment: 15000,
			securityDeposit: 180000,
			...lease,
			accountId,
			unitId
		})
		.returning({ id: leases.id });
	if (tenantIds.length > 0) {
		await db
			.insert(leaseTenants)
			.values(tenantIds.map((tenantId) => ({ leaseId: row.id, tenantId })));
	}
	return row.id;
}
