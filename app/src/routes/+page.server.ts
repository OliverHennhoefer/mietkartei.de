import { countUnmatched } from '#lib/server/bank/transactions.ts';
import { listBankAccounts } from '#lib/server/bank/accounts.ts';
import { countDeadlines } from '#lib/server/deadlines.ts';
import { listLeases, listUnitsWithProperty } from '#lib/server/leases.ts';
import { listBalances } from '#lib/server/ledger.ts';
import { listProperties } from '#lib/server/properties.ts';
import { requireAccount } from '#lib/server/session.ts';
import { listTasks } from '#lib/server/tasks.ts';
import { listTenants } from '#lib/server/tenants.ts';
import type { PageServerLoad } from './$types';

// The dashboard: four tiles that link to their lists, and a first-run checklist while the
// account has no property yet. listBalances syncs the rent charges first, so the arrears are
// current when the page opens (the same as /mietkonto does).

export type FirstRun = {
	properties: boolean;
	tenants: boolean;
	leases: boolean;
	bankAccounts: boolean;
};

export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	const [properties, tenants, leases, units, balances, unmatched, deadlines, tasks, bankAccounts] =
		await Promise.all([
			listProperties(locals.db, accountId),
			listTenants(locals.db, accountId),
			listLeases(locals.db, accountId),
			listUnitsWithProperty(locals.db, accountId),
			listBalances(locals.db, accountId),
			countUnmatched(locals.db, accountId),
			countDeadlines(locals.db, accountId),
			listTasks(locals.db, accountId),
			listBankAccounts(locals.db, accountId)
		]);

	const arrears = balances.filter((balance) => balance.balance > 0);
	const occupied = new Set(
		leases
			.filter((lease) => lease.active)
			.flatMap((lease) => [lease.unitId, ...lease.extraUnits.map((unit) => unit.id)])
	);
	const vacant = units.filter((row) => !occupied.has(row.unit.id));

	const firstRun: FirstRun = {
		properties: properties.length > 0,
		tenants: tenants.length > 0,
		leases: leases.length > 0,
		bankAccounts: bankAccounts.length > 0
	};
	return {
		firstRun: properties.length === 0 ? firstRun : null,
		tiles: {
			arrearsTotal: arrears.reduce((sum, balance) => sum + balance.balance, 0),
			arrearsCount: arrears.length,
			vacantCount: vacant.length,
			unitCount: units.length,
			unmatched,
			overdue: deadlines.overdue,
			upcoming: deadlines.upcoming,
			openTasks: tasks.open.length
		},
		vacant: vacant.slice(0, 5).map((row) => ({
			unitId: row.unit.id,
			propertyId: row.property.id,
			label: `${row.unit.name} · ${row.property.name}`
		}))
	};
};
