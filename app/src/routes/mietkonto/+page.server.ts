import { leaseLabel, listLeases } from '#lib/server/leases.ts';
import { today } from '#lib/dates.ts';
import { currentReminders } from '#lib/domain/reminders.ts';
import { listBalances } from '#lib/server/ledger.ts';
import { listRemindersByLease } from '#lib/server/reminders.ts';
import type { ReminderLevel } from '#lib/server/db/schema.ts';
import { requireAccount } from '#lib/server/session.ts';
import { personName } from '#lib/format.ts';
import type { PageServerLoad } from './$types';

// Every lease of the account with its balance. listBalances syncs the rent charges of all leases
// up to the current month first, so the arrears are current when the page opens. Rückstand is
// what is overdue today; a balance from charges not due yet (this month's rent before its due
// day, a correction dated later) is shown but not counted as Rückstand.

export type BalanceRow = {
	leaseId: string;
	label: string;
	tenants: string;
	active: boolean;
	balance: number;
	overdue: number;
	openSince: string | null;
	lastPaymentDate: string | null;
	/** The latest letter about the current Rückstand. */
	reminder: { level: ReminderLevel; date: string; paymentDeadline: string } | null;
};

export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const onlyArrears = url.searchParams.get('filter') === 'rueckstaende';
	const [leases, balances, reminders] = await Promise.all([
		listLeases(locals.db, accountId),
		listBalances(locals.db, accountId),
		listRemindersByLease(locals.db, accountId)
	]);
	const balanceByLease = new Map(balances.map((balance) => [balance.leaseId, balance]));

	const rows: BalanceRow[] = leases.map((lease) => {
		const balance = balanceByLease.get(lease.id);
		const [reminder] = currentReminders(
			reminders.get(lease.id) ?? [],
			balance?.overdue ? balance.openSinceDate : null
		);
		return {
			leaseId: lease.id,
			label: leaseLabel(lease),
			tenants: lease.tenants.map(personName).join(', '),
			active: lease.active,
			balance: balance?.balance ?? 0,
			overdue: balance?.overdue ?? 0,
			openSince: balance?.openSince ?? null,
			lastPaymentDate: balance?.lastPaymentDate ?? null,
			reminder: reminder
				? { level: reminder.level, date: reminder.date, paymentDeadline: reminder.paymentDeadline }
				: null
		};
	});
	rows.sort((a, b) => {
		const arrearsA = a.overdue > 0 ? 1 : 0;
		const arrearsB = b.overdue > 0 ? 1 : 0;
		return arrearsB - arrearsA || a.label.localeCompare(b.label, 'de');
	});

	const arrears = rows.filter((row) => row.overdue > 0);
	const credits = rows.filter((row) => row.balance < 0);
	return {
		leaseCount: rows.length,
		rows: onlyArrears ? arrears : rows,
		onlyArrears,
		today: today(),
		stats: {
			arrearsTotal: arrears.reduce((sum, row) => sum + row.overdue, 0),
			arrearsCount: arrears.length,
			creditTotal: credits.reduce((sum, row) => sum - row.balance, 0),
			creditCount: credits.length
		}
	};
};
