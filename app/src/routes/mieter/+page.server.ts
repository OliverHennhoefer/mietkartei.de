import { daysBetween, today, type IsoDate, type IsoMonth } from '#lib/dates.ts';
import { total } from '#lib/domain/rents.ts';
import { currentReminders } from '#lib/domain/reminders.ts';
import { personName } from '#lib/format.ts';
import { leaseLabel, listLeases, type LeaseSummary } from '#lib/server/leases.ts';
import { listBalances } from '#lib/server/ledger.ts';
import { listRemindersByLease } from '#lib/server/reminders.ts';
import type { ReminderLevel, TerminatedBy } from '#lib/server/db/schema.ts';
import { requireAccount } from '#lib/server/session.ts';
import { listTenants } from '#lib/server/tenants.ts';
import type { PageServerLoad } from './$types';

export type Pending =
	| {
			kind: 'arrears';
			tenantId: string;
			name: string;
			overdue: number;
			openSince: IsoMonth;
			reminder: { level: ReminderLevel; date: IsoDate } | null;
	  }
	| {
			kind: 'out';
			tenantId: string;
			name: string;
			date: IsoDate;
			terminatedBy: TerminatedBy | null;
			label: string;
	  }
	| { kind: 'in'; tenantId: string; name: string; id: string; date: IsoDate; label: string };

// Tenants with their active leases, the archived ones (moved out) apart: one query for the
// tenants, one set for the leases, so the number of queries does not grow with the number of
// tenants. The active tenants are grouped by property (by name; a tenant renting in several goes
// with the first), the tenants without an active lease last; within a group they keep the name
// order. groupId (the property's id, null for none) lets the page draw a divider between groups.
//
// Each tenant carries what matters today: the Warmmiete, the Rückstand with the latest letter
// about it, since when they rent, a notice given and a lease about to begin; the page puts what
// needs doing above the list and sums the tenants up in one line.
export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	const date = today();
	const [tenants, leases, balances, reminders] = await Promise.all([
		listTenants(locals.db, accountId, { archived: true }),
		listLeases(locals.db, accountId),
		listBalances(locals.db, accountId, { asOf: date }),
		listRemindersByLease(locals.db, accountId)
	]);
	const balanceByLease = new Map(balances.map((balance) => [balance.leaseId, balance]));
	const leasesByTenant = new Map<string, LeaseSummary[]>();
	for (const lease of leases) {
		for (const tenant of lease.tenants) {
			const list = leasesByTenant.get(tenant.id) ?? [];
			list.push(lease);
			leasesByTenant.set(tenant.id, list);
		}
	}

	const rows = tenants.map((tenant) => {
		const own = leasesByTenant.get(tenant.id) ?? [];
		const active = own.filter((lease) => lease.active);
		let overdue = 0;
		let openSince: IsoMonth | null = null;
		const letters: { level: ReminderLevel; date: IsoDate }[] = [];
		for (const lease of own) {
			const balance = balanceByLease.get(lease.id);
			if (!balance?.overdue) continue;
			overdue += balance.overdue;
			if (balance.openSince && (!openSince || balance.openSince < openSince)) {
				openSince = balance.openSince;
			}
			for (const sent of currentReminders(reminders.get(lease.id) ?? [], balance.openSinceDate)) {
				letters.push({ level: sent.level, date: sent.date });
			}
		}
		// The letters about the current Rückstand across the leases, oldest first; on the same day the
		// lower level first. The page stacks one pill per letter, the pending list names the latest.
		letters.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.level - b.level));
		const reminder = letters.at(-1) ?? null;
		const moveOut = active
			.filter((lease) => lease.endDate)
			.sort((a, b) => a.endDate!.localeCompare(b.endDate!))[0];
		const moveIn = own
			.filter((lease) => lease.upcoming)
			.sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
		return {
			...tenant,
			activeLeases: active.map((lease) => ({
				id: lease.id,
				label: leaseLabel(lease),
				unit: lease.unit.name,
				property: lease.property.name
			})),
			rent: active.reduce((sum, lease) => sum + total(lease.currentRent), 0),
			overdue,
			openSince,
			reminder,
			reminders: letters,
			/** The start of the earliest lease that has begun. */
			since:
				own
					.filter((lease) => !lease.upcoming)
					.map((lease) => lease.startDate)
					.sort()[0] ?? null,
			moveOut: moveOut
				? {
						date: moveOut.endDate!,
						terminatedBy: moveOut.terminatedBy,
						label: leaseLabel(moveOut)
					}
				: null,
			moveIn: moveIn
				? {
						id: moveIn.id,
						date: moveIn.startDate,
						label: leaseLabel(moveIn),
						unit: moveIn.unit.name,
						property: moveIn.property.name
					}
				: null
		};
	});
	// By name, and properties of the same name apart by id, so each group stays together.
	const byProperty = (a: LeaseSummary['property'], b: LeaseSummary['property']) =>
		a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id);
	const active = rows
		.filter((tenant) => !tenant.archivedAt)
		.map((tenant) => ({
			tenant,
			property: (leasesByTenant.get(tenant.id) ?? [])
				.filter((lease) => lease.active)
				.map((lease) => lease.property)
				.sort(byProperty)[0]
		}))
		.sort((a, b) =>
			a.property && b.property
				? byProperty(a.property, b.property)
				: Number(!a.property) - Number(!b.property)
		)
		.map(({ tenant, property }) => ({ ...tenant, groupId: property?.id ?? null }));

	// What needs doing, above the list: the Rückstände, largest first, then the moves by date.
	const moves = active.flatMap((tenant) => {
		const name = personName(tenant);
		const own: Extract<Pending, { date: IsoDate }>[] = [];
		if (tenant.moveOut) {
			own.push({
				kind: 'out',
				tenantId: tenant.id,
				name,
				date: tenant.moveOut.date,
				terminatedBy: tenant.moveOut.terminatedBy,
				label: tenant.moveOut.label
			});
		}
		if (tenant.moveIn) {
			own.push({ kind: 'in', tenantId: tenant.id, name, ...tenant.moveIn });
		}
		return own;
	});
	const pending: Pending[] = [
		...active
			.filter((tenant) => tenant.overdue > 0)
			.sort((a, b) => b.overdue - a.overdue)
			.map((tenant) => ({
				kind: 'arrears' as const,
				tenantId: tenant.id,
				name: personName(tenant),
				overdue: tenant.overdue,
				openSince: tenant.openSince!,
				reminder: tenant.reminder
			})),
		...moves.sort((a, b) => a.date.localeCompare(b.date))
	];

	// The line under it, over the leases running today.
	const running = leases.filter((lease) => lease.active);
	const tenures = running.map((lease) => daysBetween(lease.startDate, date));
	return {
		tenants: active,
		archived: rows.filter((tenant) => tenant.archivedAt),
		pending,
		overview: {
			renting: active.filter((tenant) => tenant.activeLeases.length > 0).length,
			households: running.length,
			rent: running.reduce((sum, lease) => sum + total(lease.currentRent), 0),
			/** Average years the running leases have run so far, null without one. */
			tenure: tenures.length
				? tenures.reduce((sum, days) => sum + days, 0) / tenures.length / 365.25
				: null
		}
	};
};
