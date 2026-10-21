import type { Database } from './db';
import { accounts, properties, tenants, units, users } from './db/schema';
import { createSqliteDatabase } from './db/sqlite';
import { createLease, type LeaseInput } from './leases';
import type { TenantInput } from './tenants';

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

/** A property with one unit; returns both ids. */
export async function seedUnit(
	db: Database,
	accountId: string,
	overrides: { name?: string; floorArea?: number | null; propertyName?: string } = {}
) {
	const [property] = await db
		.insert(properties)
		.values({ accountId, name: overrides.propertyName ?? 'Haus', ...address })
		.returning({ id: properties.id });
	const [unit] = await db
		.insert(units)
		.values({
			accountId,
			propertyId: property.id,
			name: overrides.name ?? 'EG links',
			kind: 'apartment',
			floorArea: overrides.floorArea === undefined ? 64 : overrides.floorArea
		})
		.returning({ id: units.id });
	return { propertyId: property.id, unitId: unit.id };
}

export function tenantInput(overrides: Partial<TenantInput> = {}): TenantInput {
	return {
		salutation: null,
		firstName: 'Erika',
		lastName: 'Mustermann',
		email: null,
		phone: null,
		street: null,
		postalCode: null,
		city: null,
		notes: null,
		...overrides
	};
}

export async function seedTenant(
	db: Database,
	accountId: string,
	overrides: Partial<TenantInput> = {}
) {
	const [tenant] = await db
		.insert(tenants)
		.values({ accountId, ...tenantInput(overrides) })
		.returning({ id: tenants.id });
	return tenant.id;
}

/** A plain residential lease from 2025-01-01 at 600 € + 150 € + 50 €. */
export function leaseInput(unitId: string, overrides: Partial<LeaseInput> = {}): LeaseInput {
	return {
		unitId,
		extraUnitIds: [],
		tenantIds: [],
		startDate: '2025-01-01',
		endDate: null,
		kind: 'residential',
		rentModel: 'fixed',
		operatingCostModel: 'prepayment',
		heatingCostModel: 'prepayment',
		baseRent: 60000,
		operatingCostPrepayment: 15000,
		heatingCostPrepayment: 5000,
		securityDeposit: 180000,
		persons: 2,
		rentDueDay: 3,
		ledgerStart: null,
		terminatedAt: null,
		terminatedBy: null,
		notes: null,
		...overrides
	};
}

/** Creates a lease of the unit with leaseInput() and the overrides; returns its id. */
export async function seedLease(
	db: Database,
	accountId: string,
	unitId: string,
	overrides: Partial<LeaseInput> = {}
): Promise<string> {
	const result = await createLease(db, { accountId, userId: null }, leaseInput(unitId, overrides));
	if (!result.ok) throw new Error(`seedLease failed: ${result.reason}`);
	return result.id;
}
