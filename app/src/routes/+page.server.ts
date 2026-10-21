import { count, eq } from 'drizzle-orm';
import { countUnmatched } from '#lib/server/bank/transactions.ts';
import { listBankAccounts } from '#lib/server/bank/accounts.ts';
import { costCategories } from '#lib/server/db/schema.ts';
import { countDeadlines } from '#lib/server/deadlines.ts';
import { listLeases, listUnitsWithProperty } from '#lib/server/leases.ts';
import { listBalances } from '#lib/server/ledger.ts';
import { listProperties } from '#lib/server/properties.ts';
import { requireAccount } from '#lib/server/session.ts';
import { countOpenTasks } from '#lib/server/tasks.ts';
import { listTenants } from '#lib/server/tenants.ts';
import type { PageServerLoad } from './$types';

// The dashboard: four tiles that link to their lists, and instead of them a first-run checklist
// until the account has a lease and a bank account. listBalances syncs the rent charges first, so
// the arrears are current when the page opens (the same as /mietkonto does).

export type FirstRun = {
	properties: boolean;
	units: boolean;
	tenants: boolean;
	leases: boolean;
	bankAccounts: boolean;
	/** The default cost categories are created when a Betriebskosten page is first opened. */
	categories: boolean;
	/** Where "Einheit anlegen" leads: the first property's page, which has the unit form. */
	firstPropertyId: string | null;
};

export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	const [
		properties,
		tenants,
		leases,
		units,
		balances,
		unmatched,
		deadlines,
		openTasks,
		bankAccounts,
		[categories]
	] = await Promise.all([
		listProperties(locals.db, accountId),
		listTenants(locals.db, accountId),
		listLeases(locals.db, accountId),
		listUnitsWithProperty(locals.db, accountId),
		listBalances(locals.db, accountId),
		countUnmatched(locals.db, accountId),
		countDeadlines(locals.db, accountId),
		countOpenTasks(locals.db, accountId),
		listBankAccounts(locals.db, accountId),
		locals.db
			.select({ value: count() })
			.from(costCategories)
			.where(eq(costCategories.accountId, accountId))
	]);

	// Rückstand is what is overdue today, not this month's rent before its due day.
	const arrears = balances.filter((balance) => balance.overdue > 0);
	const occupied = new Set(
		leases
			.filter((lease) => lease.active)
			.flatMap((lease) => [lease.unitId, ...lease.extraUnits.map((unit) => unit.id)])
	);
	const vacant = units.filter((row) => !occupied.has(row.unit.id));

	const firstRun: FirstRun = {
		properties: properties.length > 0,
		units: units.length > 0,
		tenants: tenants.length > 0,
		leases: leases.length > 0,
		bankAccounts: bankAccounts.length > 0,
		categories: categories.value > 0,
		firstPropertyId: properties[0]?.id ?? null
	};
	return {
		firstRun: firstRun.leases && firstRun.bankAccounts ? null : firstRun,
		tiles: {
			arrearsTotal: arrears.reduce((sum, balance) => sum + balance.overdue, 0),
			arrearsCount: arrears.length,
			vacantCount: vacant.length,
			unitCount: units.length,
			unmatched,
			overdue: deadlines.overdue,
			upcoming: deadlines.upcoming,
			openTasks
		},
		vacant: vacant.slice(0, 5).map((row) => ({
			unitId: row.unit.id,
			propertyId: row.property.id,
			label: `${row.unit.name} · ${row.property.name}`
		}))
	};
};
