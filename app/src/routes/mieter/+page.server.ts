import { leaseLabel, listLeases, type LeaseSummary } from '#lib/server/leases.ts';
import { requireAccount } from '#lib/server/session.ts';
import { listTenants } from '#lib/server/tenants.ts';
import type { PageServerLoad } from './$types';

// Tenants with their active leases, the archived ones (moved out) apart: one query for the
// tenants, one set for the leases, so the number of queries does not grow with the number of
// tenants. The active tenants are grouped by property (by name; a tenant renting in several goes
// with the first), the tenants without an active lease last; within a group they keep the name
// order. groupId (the property's id, null for none) lets the page draw a divider between groups.
export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	const [tenants, leases] = await Promise.all([
		listTenants(locals.db, accountId, { archived: true }),
		listLeases(locals.db, accountId)
	]);
	const activeByTenant = new Map<string, LeaseSummary[]>();
	for (const lease of leases) {
		if (!lease.active) continue;
		for (const tenant of lease.tenants) {
			const list = activeByTenant.get(tenant.id) ?? [];
			list.push(lease);
			activeByTenant.set(tenant.id, list);
		}
	}
	const rows = tenants.map((tenant) => ({
		...tenant,
		activeLeases: (activeByTenant.get(tenant.id) ?? []).map((lease) => ({
			id: lease.id,
			label: leaseLabel(lease)
		}))
	}));
	// By name, and properties of the same name apart by id, so each group stays together.
	const byProperty = (a: LeaseSummary['property'], b: LeaseSummary['property']) =>
		a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id);
	const active = rows
		.filter((tenant) => !tenant.archivedAt)
		.map((tenant) => ({
			tenant,
			property: (activeByTenant.get(tenant.id) ?? [])
				.map((lease) => lease.property)
				.sort(byProperty)[0]
		}))
		.sort((a, b) =>
			a.property && b.property
				? byProperty(a.property, b.property)
				: Number(!a.property) - Number(!b.property)
		)
		.map(({ tenant, property }) => ({ ...tenant, groupId: property?.id ?? null }));
	return {
		tenants: active,
		archived: rows.filter((tenant) => tenant.archivedAt)
	};
};
