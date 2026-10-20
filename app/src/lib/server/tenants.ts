import { and, asc, count, eq } from 'drizzle-orm';
import type { Database } from './db';
import { leaseTenants, tenants } from './db/schema';

// All queries take the account explicitly, so data of one account can never leak into another.

export type TenantInput = {
	salutation: string | null;
	firstName: string;
	lastName: string;
	email: string | null;
	phone: string | null;
	street: string | null;
	postalCode: string | null;
	city: string | null;
	notes: string | null;
};

export async function listTenants(db: Database, accountId: string) {
	return db
		.select()
		.from(tenants)
		.where(eq(tenants.accountId, accountId))
		.orderBy(asc(tenants.lastName), asc(tenants.firstName), asc(tenants.createdAt));
}

export async function getTenant(db: Database, accountId: string, tenantId: string) {
	const [tenant] = await db
		.select()
		.from(tenants)
		.where(and(eq(tenants.accountId, accountId), eq(tenants.id, tenantId)));
	return tenant;
}

export async function createTenant(db: Database, accountId: string, input: TenantInput) {
	const [tenant] = await db
		.insert(tenants)
		.values({ ...input, accountId })
		.returning();
	return tenant;
}

/** Returns false when the tenant does not exist in this account. */
export async function updateTenant(
	db: Database,
	accountId: string,
	tenantId: string,
	input: TenantInput
): Promise<boolean> {
	const updated = await db
		.update(tenants)
		.set(input)
		.where(and(eq(tenants.accountId, accountId), eq(tenants.id, tenantId)))
		.returning({ id: tenants.id });
	return updated.length > 0;
}

/** A tenant with leases cannot be deleted; the leases keep the history. */
export async function deleteTenant(
	db: Database,
	accountId: string,
	tenantId: string
): Promise<'deleted' | 'in-use' | 'missing'> {
	if (!(await getTenant(db, accountId, tenantId))) return 'missing';
	const [{ value }] = await db
		.select({ value: count() })
		.from(leaseTenants)
		.where(eq(leaseTenants.tenantId, tenantId));
	if (value > 0) return 'in-use';
	await db.delete(tenants).where(and(eq(tenants.accountId, accountId), eq(tenants.id, tenantId)));
	return 'deleted';
}

/** The given tenants, only those that belong to the account, in the order given. */
export async function findTenants(db: Database, accountId: string, tenantIds: string[]) {
	if (tenantIds.length === 0) return [];
	const rows = await db.select().from(tenants).where(eq(tenants.accountId, accountId));
	return tenantIds.flatMap((id) => rows.filter((row) => row.id === id));
}
