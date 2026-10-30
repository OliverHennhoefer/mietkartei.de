import { fail } from '@sveltejs/kit';
import {
	getLease,
	leaseLabel,
	leasePlace,
	listLeases,
	type LeaseSummary
} from '#lib/server/leases.ts';
import { today } from '#lib/dates.ts';
import { total } from '#lib/domain/rents.ts';
import { currentReminders } from '#lib/domain/reminders.ts';
import { createPayment, listBalances, listLedger } from '#lib/server/ledger.ts';
import { listRemindersByLease } from '#lib/server/reminders.ts';
import type { ReminderLevel } from '#lib/server/db/schema.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { personName } from '#lib/format.ts';
import type { Actions, PageServerLoad } from './$types';

// Every lease of the account with its balance. listBalances syncs the rent charges of all leases
// up to the current month first, so the arrears are current when the page opens. Rückstand is
// what is overdue today; a balance from charges not due yet (this month's rent before its due
// day, a correction dated later) is shown but not counted as Rückstand.
//
// "Miete ist da" books what a running lease owes, at most one month's rent, as a manual payment
// dated today: one click per tenant for a landlord who checks the bank account by hand.

export type BalanceRow = {
	leaseId: string;
	label: string;
	/** The label in two lines: the unit, under it the property (null when the unit names it). */
	place: { unit: string; property: string | null };
	tenants: string;
	status: 'active' | 'upcoming' | 'ended';
	balance: number;
	overdue: number;
	openSince: string | null;
	lastPaymentDate: string | null;
	/** What "Miete ist da" books; null when the lease owes nothing or has ended. */
	rentReceived: number | null;
	/** The latest letter about the current Rückstand. */
	reminder: { level: ReminderLevel; date: string; paymentDeadline: string } | null;
};

/** What "Miete ist da" books: the balance, at most the current monthly rent. */
function rentReceivedAmount(lease: LeaseSummary, balance: number): number | null {
	if (!lease.active || balance <= 0) return null;
	const rent = total(lease.currentRent);
	return rent > 0 ? Math.min(balance, rent) : null;
}

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
		const owed = balance?.balance ?? 0;
		return {
			leaseId: lease.id,
			label: leaseLabel(lease),
			place: leasePlace(lease),
			tenants: lease.tenants.map(personName).join(', '),
			status: lease.active ? 'active' : lease.upcoming ? 'upcoming' : 'ended',
			balance: owed,
			overdue: balance?.overdue ?? 0,
			openSince: balance?.openSince ?? null,
			lastPaymentDate: balance?.lastPaymentDate ?? null,
			rentReceived: rentReceivedAmount(lease, owed),
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
	return {
		leaseCount: rows.length,
		rows: onlyArrears ? arrears : rows,
		onlyArrears,
		today: today()
	};
};

export const actions: Actions = {
	received: async ({ request, locals }) => {
		const accountId = requireAccount(locals);
		const leaseId = String((await request.formData()).get('leaseId') ?? '');
		const lease = await getLease(locals.db, accountId, leaseId);
		if (!lease) return fail(404, { message: 'Diesen Mietvertrag gibt es nicht.' });
		const { balance } = await listLedger(locals.db, accountId, leaseId);
		const amount = rentReceivedAmount(lease, balance);
		if (!amount) return fail(400, { message: 'Für diesen Mietvertrag ist nichts offen.' });
		await createPayment(locals.db, auditContext(locals), {
			leaseId,
			date: today(),
			amount,
			source: 'manual',
			note: null
		});
		return { received: { leaseId, label: leaseLabel(lease), amount } };
	}
};
