import { and, asc, eq, isNull } from 'drizzle-orm';
import { today, type IsoDate } from '../dates';
import { personName } from '../format';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { tenants } from './db/schema';
import { leaseLabel, type LeaseSummary } from './leases';
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

/** Archived tenants only with `archived: true`, e.g. for the list's archive or the API. */
export async function listTenants(
	db: Database,
	accountId: string,
	options: { archived?: boolean } = {}
) {
	return db
		.select()
		.from(tenants)
		.where(
			and(
				eq(tenants.accountId, accountId),
				options.archived ? undefined : isNull(tenants.archivedAt)
			)
		)
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

type Address = { street: string | null; postalCode: string | null; city: string | null };

function addressLine(address: Address): string {
	return [address.street, [address.postalCode, address.city].filter(Boolean).join(' ')]
		.filter(Boolean)
		.join(', ');
}

/**
 * Where letters reach the tenant: their own postal address, else the address of the property they
 * rent. That is the lease the tenant is a party to today, before it begins the next one, after
 * all ended the latest; a lease they left (or join later) counts by their own days on it, not by
 * the lease's. Null for a tenant without address and without lease. `lease` names the lease the
 * address comes from.
 */
export function postalAddress(
	tenant: Address & { id: string },
	leases: readonly LeaseSummary[],
	date: IsoDate = today()
): { line: string; lease: string | null } | null {
	const own = addressLine(tenant);
	if (own) return { line: own, lease: null };
	const spans = leases.flatMap((lease) => {
		const party = lease.parties.find((entry) => entry.tenant.id === tenant.id);
		if (!party) return [];
		const from =
			party.joinedOn && party.joinedOn > lease.startDate ? party.joinedOn : lease.startDate;
		const ends = [lease.endDate, party.leftOn].filter((day): day is IsoDate => day !== null);
		const to = ends.length > 0 ? ends.sort()[0] : null;
		return [{ lease, from, to }];
	});
	const span =
		spans.find(({ from, to }) => from <= date && (to === null || to >= date)) ??
		spans.filter(({ from }) => from > date).sort((a, b) => a.from.localeCompare(b.from))[0] ??
		spans.sort((a, b) => (b.to ?? b.from).localeCompare(a.to ?? a.from))[0];
	if (!span) return null;
	return { line: addressLine(span.lease.property), lease: leaseLabel(span.lease) };
}
