import { leaseLabel, listLeases } from '#lib/server/leases.ts';
import { listBalances } from '#lib/server/ledger.ts';
import { requireAccount } from '#lib/server/session.ts';
import { personName } from '#lib/format.ts';
import type { PageServerLoad } from './$types';

// Every lease of the account with its balance. listBalances syncs the rent charges of all leases
// up to the current month first, so the arrears are current when the page opens.

export type BalanceRow = {
	leaseId: string;
	label: string;
	tenants: string;
	active: boolean;
	balance: number;
	openSince: string | null;
	lastPaymentDate: string | null;
};

export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const onlyArrears = url.searchParams.get('filter') === 'rueckstaende';
	const [leases, balances] = await Promise.all([
		listLeases(locals.db, accountId),
		listBalances(locals.db, accountId)
	]);
	const balanceByLease = new Map(balances.map((balance) => [balance.leaseId, balance]));

	const rows: BalanceRow[] = leases.map((lease) => {
		const balance = balanceByLease.get(lease.id);
		return {
			leaseId: lease.id,
			label: leaseLabel(lease),
			tenants: lease.tenants.map(personName).join(', '),
			active: lease.active,
			balance: balance?.balance ?? 0,
			openSince: balance?.openSince ?? null,
			lastPaymentDate: balance?.lastPaymentDate ?? null
		};
	});
	rows.sort((a, b) => {
		const arrearsA = a.balance > 0 ? 1 : 0;
		const arrearsB = b.balance > 0 ? 1 : 0;
		return arrearsB - arrearsA || a.label.localeCompare(b.label, 'de');
	});

	const arrears = rows.filter((row) => row.balance > 0);
	const credits = rows.filter((row) => row.balance < 0);
	return {
		leaseCount: rows.length,
		rows: onlyArrears ? arrears : rows,
		onlyArrears,
		stats: {
			arrearsTotal: arrears.reduce((sum, row) => sum + row.balance, 0),
			arrearsCount: arrears.length,
			creditTotal: credits.reduce((sum, row) => sum - row.balance, 0),
			creditCount: credits.length
		}
	};
};
