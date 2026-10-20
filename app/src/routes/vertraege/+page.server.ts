import { today } from '#lib/dates.ts';
import { personName } from '#lib/format.ts';
import { leaseLabel, listLeases, listUnitsWithProperty } from '#lib/server/leases.ts';
import { requireAccount } from '#lib/server/session.ts';
import { listTenants } from '#lib/server/tenants.ts';
import type { PageServerLoad } from './$types';

export type LeaseStatus = 'active' | 'upcoming' | 'ended';

/** Active today, not started yet, or ended. */
function leaseStatus(lease: { active: boolean; startDate: string }, date: string): LeaseStatus {
	if (lease.active) return 'active';
	return lease.startDate > date ? 'upcoming' : 'ended';
}

// All leases, active first, then the ones that have not started yet, then the ended ones; within
// a group the newest start first. The empty state needs to know whether units and tenants exist,
// so it can name what is missing.
export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	const leases = await listLeases(locals.db, accountId);
	const date = today();
	const order: Record<LeaseStatus, number> = { active: 0, upcoming: 1, ended: 2 };
	const rows = leases
		.map((lease) => ({
			id: lease.id,
			label: leaseLabel(lease),
			extraUnits: lease.extraUnits.map((unit) => unit.name),
			tenants: lease.tenants.map(personName).join(', '),
			startDate: lease.startDate,
			endDate: lease.endDate,
			total:
				lease.currentRent.baseRent +
				lease.currentRent.operatingCostPrepayment +
				lease.currentRent.heatingCostPrepayment,
			status: leaseStatus(lease, date)
		}))
		.sort((a, b) => order[a.status] - order[b.status] || b.startDate.localeCompare(a.startDate));

	let prerequisites = { units: true, tenants: true };
	if (leases.length === 0) {
		const [units, tenants] = await Promise.all([
			listUnitsWithProperty(locals.db, accountId),
			listTenants(locals.db, accountId)
		]);
		prerequisites = { units: units.length > 0, tenants: tenants.length > 0 };
	}
	return { leases: rows, prerequisites };
};
