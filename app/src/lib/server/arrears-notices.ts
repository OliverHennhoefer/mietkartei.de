import { and, eq, isNotNull, max } from 'drizzle-orm';
import { leaseTenantName } from '../domain/addressee';
import { addDays, dayOf, formatDate, type IsoDate } from '../dates';
import { formatCents } from '../money';
import { isWorkingDay } from '../working-days';
import type { CalendarEntry } from './calendar';
import type { Database } from './db';
import { bankAccounts, bankConnections, bankTransactions } from './db/schema';
import { countUnmatched } from './bank/transactions';
import { leaseLabel, listLeases } from './leases';
import { listBalances } from './ledger';

// Hinweise about money that did not come in. A lease whose newest charge is not paid at all gets
// "Miete ausgeblieben" once per charge; a part left open gets "Rückstand" once per charge it
// reaches, so about once a month while it stays open, since payments settle the oldest first.
// A transfer ordered on the due day may take a while, so nothing is told before two working days
// after it. And nothing is told from statements that do not reach that far: when the account
// keeps bank accounts, its imported or fetched transactions must cover that day, or the money may
// simply not be imported yet. Without bank accounts the payments entered by hand are all there is.

/** Working days after the due date that a payment may still arrive. */
export const ARREARS_GRACE_WORKING_DAYS = 2;

/** The day the money should be there: two working days after `due` (national holidays). */
export function paymentExpectedBy(due: IsoDate): IsoDate {
	let date = due;
	for (let left = ARREARS_GRACE_WORKING_DAYS; left > 0;) {
		date = addDays(date, 1);
		if (isWorkingDay(date, null)) left -= 1;
	}
	return date;
}

/**
 * The last day the account's bank data covers: the newest booking or the last Bankabruf,
 * whichever is later. Undefined when the account keeps no bank account, so payments are entered
 * by hand; null when it keeps one but nothing came in yet.
 */
async function bankDataUntil(db: Database, accountId: string): Promise<IsoDate | null | undefined> {
	const [[accountsRow], [bookingRow], [syncRow]] = await Promise.all([
		db
			.select({ id: bankAccounts.id })
			.from(bankAccounts)
			.where(eq(bankAccounts.accountId, accountId))
			.limit(1),
		db
			.select({ date: max(bankTransactions.bookingDate) })
			.from(bankTransactions)
			.where(eq(bankTransactions.accountId, accountId)),
		db
			.select({ at: max(bankConnections.lastSyncedAt) })
			.from(bankConnections)
			.where(and(eq(bankConnections.accountId, accountId), isNotNull(bankConnections.lastSyncedAt)))
	]);
	if (!accountsRow) return undefined;
	const synced = syncRow?.at ? dayOf(new Date(syncRow.at)) : null;
	const booked = bookingRow?.date ?? null;
	if (!synced) return booked;
	if (!booked) return synced;
	return synced > booked ? synced : booked;
}

/** The Hinweise about missing payments on `today`, one per lease at most. */
export async function arrearsEntries(
	db: Database,
	accountId: string,
	origin: string,
	today: IsoDate
): Promise<CalendarEntry[]> {
	const balances = (await listBalances(db, accountId, { asOf: today })).filter(
		(balance) => balance.overdue > 0 && balance.lastDue && balance.openSinceDate
	);
	if (balances.length === 0) return [];
	const [leases, dataUntil, unmatched] = await Promise.all([
		listLeases(db, accountId),
		bankDataUntil(db, accountId),
		countUnmatched(db, accountId)
	]);
	const entries: CalendarEntry[] = [];
	for (const balance of balances) {
		const lastDue = balance.lastDue!;
		// Payments settle the oldest charges first, so the newest is unpaid when the Rückstand
		// covers it; else only an older part is open, told once from the day it fell due.
		const missed = balance.overdue >= lastDue.amount;
		const date = missed ? lastDue.date : balance.openSinceDate!;
		const expected = paymentExpectedBy(date);
		if (today < expected) continue;
		if (dataUntil !== undefined && (dataUntil === null || dataUntil < expected)) continue;
		const lease = leases.find((row) => row.id === balance.leaseId);
		const name = lease ? leaseTenantName(lease.tenants) || leaseLabel(lease) : 'Mietvertrag';
		const title = missed
			? lastDue.rent
				? 'Miete ausgeblieben'
				: 'Zahlung ausgeblieben'
			: 'Rückstand';
		const detail = [
			missed
				? `${name}: ${formatCents(lastDue.amount)}, fällig am ${formatDate(lastDue.date)}, ist nicht eingegangen.`
				: `${name}: ${formatCents(balance.overdue)} sind seit dem ${formatDate(balance.openSinceDate!)} offen.`,
			missed && balance.overdue > lastDue.amount
				? `Insgesamt offen: ${formatCents(balance.overdue)}.`
				: '',
			unmatched > 0
				? `${unmatched === 1 ? 'Ein Bankumsatz ist' : `${unmatched} Bankumsätze sind`} noch nicht zugeordnet, vielleicht ist die Zahlung dabei.`
				: ''
		]
			.filter(Boolean)
			.join(' ');
		entries.push({
			uid: `arrears-${balance.leaseId}@mietkartei.de`,
			key: `arrears-${balance.leaseId}`,
			kind: 'arrears',
			date,
			title,
			overdue: true,
			summary: title,
			description: detail,
			url: `${origin}/vertraege/${balance.leaseId}/mietkonto`
		});
	}
	return entries;
}
