import { and, asc, eq } from 'drizzle-orm';
import { personName } from '../format';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { tenants } from './db/schema';
import { assertQuota } from './quotas';

// All queries take the account explicitly, so data of one account can never leak into another.
// Changes write their audit line in the same batch as the change itself.

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

/** Creates the tenant and its audit line atomically; returns the new id. */
export async function createTenant(
	db: Database,
	context: AuditContext,
	input: TenantInput
): Promise<{ id: string }> {
	await assertQuota(db, context.accountId, 'tenants');
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(tenants).values({ ...input, id, accountId: context.accountId }),
		auditEntry(db, context, 'tenant', id, 'create', `Mieter ${personName(input)} angelegt`)
	]);
	return { id };
}

/** Returns false when the tenant does not exist in this account. */
export async function updateTenant(
	db: Database,
	context: AuditContext,
	tenantId: string,
	input: TenantInput
): Promise<boolean> {
	if (!(await getTenant(db, context.accountId, tenantId))) return false;
	await runBatch(db, [
		db
			.update(tenants)
			.set(input)
			.where(and(eq(tenants.accountId, context.accountId), eq(tenants.id, tenantId))),
		auditEntry(db, context, 'tenant', tenantId, 'update', `Mieter ${personName(input)} geändert`)
	]);
	return true;
}
