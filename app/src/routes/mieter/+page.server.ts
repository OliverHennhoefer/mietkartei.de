import { leaseLabel, listLeases, type LeaseSummary } from '#lib/server/leases.ts';
import { requireAccount } from '#lib/server/session.ts';
import { listTenants } from '#lib/server/tenants.ts';
import type { PageServerLoad } from './$types';

// Tenants with their active leases: one query for the tenants, one set for the leases, so the
// number of queries does not grow with the number of tenants.
export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	const [tenants, leases] = await Promise.all([
		listTenants(locals.db, accountId),
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
	return {
		tenants: tenants.map((tenant) => ({
			...tenant,
			activeLeases: (activeByTenant.get(tenant.id) ?? []).map((lease) => ({
				id: lease.id,
				label: leaseLabel(lease)
			}))
		}))
	};
};
