import { and, asc, eq, gte, lte } from 'drizzle-orm';
import {
	accountLengthOf,
	datevBuchungsstapel,
	windows1252,
	type DatevBooking
} from '../../domain/datev';
import { auditEntry, type AuditContext } from '../audit';
import type { Database } from '../db';
import { runBatch } from '../db/batch';
import {
	accounts,
	bankAccounts,
	bankTransactions,
	contraAccounts,
	depositTransactions,
	expenses,
	otherBookings,
	payments
} from '../db/schema';

// DATEV-Export: the assigned bank transactions of a period as a Buchungsstapel. Each booking
// goes from the bank account's Kontonummer to the Gegenkonto it was booked to; a rent payment
// split into Kaltmiete and Nebenkosten gives one line per part. Six queries, none with a list
// of ids, so the period may be as long as a year.

export interface DatevNumbers {
	advisorNumber: string | null;
	clientNumber: string | null;
}

export async function getDatevNumbers(db: Database, accountId: string): Promise<DatevNumbers> {
	const [row] = await db
		.select({
			advisorNumber: accounts.datevAdvisorNumber,
			clientNumber: accounts.datevClientNumber
		})
		.from(accounts)
		.where(eq(accounts.id, accountId));
	return row ?? { advisorNumber: null, clientNumber: null };
}

export async function setDatevNumbers(
	db: Database,
	context: AuditContext,
	numbers: { advisorNumber: string; clientNumber: string }
): Promise<void> {
	await runBatch(db, [
		db
			.update(accounts)
			.set({
				datevAdvisorNumber: numbers.advisorNumber,
				datevClientNumber: numbers.clientNumber
			})
			.where(eq(accounts.id, context.accountId)),
		auditEntry(
			db,
			context,
			'account',
			context.accountId,
			'update',
			`DATEV-Beraternummer ${numbers.advisorNumber} und Mandantennummer ${numbers.clientNumber} gespeichert`
		)
	]);
}

/** Why an assigned transaction is not in the file. */
export type DatevGap = 'no-ledger-number' | 'no-contra-account' | 'no-contra-number';

export interface DatevSkipped {
	id: string;
	date: string;
	amount: number;
	counterpartName: string;
	bankAccount: string;
	reason: DatevGap;
}

export interface DatevExport {
	bookings: DatevBooking[];
	skipped: DatevSkipped[];
	/** Sachkontenlänge, and the numbers of another length (DATEV would refuse them). */
	accountLength: number;
	uneven: string[];
}

const valid = (number: string | null | undefined): number is string =>
	!!number && /^\d{1,9}$/.test(number);

/** The assigned transactions booked between from and to (YYYY-MM-DD, inclusive). */
export async function datevExport(
	db: Database,
	accountId: string,
	from: string,
	to: string
): Promise<DatevExport> {
	const inPeriod = and(
		eq(bankTransactions.accountId, accountId),
		eq(bankTransactions.status, 'matched'),
		gte(bankTransactions.bookingDate, from),
		lte(bankTransactions.bookingDate, to)
	);
	const part = (table: typeof payments | typeof expenses | typeof otherBookings) =>
		db
			.select({
				bankTransactionId: bankTransactions.id,
				amount: table.amount,
				contraAccountId: table.contraAccountId
			})
			.from(table)
			.innerJoin(bankTransactions, eq(table.bankTransactionId, bankTransactions.id))
			.where(and(eq(table.accountId, accountId), inPeriod));
	const [transactions, contra, paymentParts, depositParts, expenseParts, otherParts] =
		await Promise.all([
			db
				.select({
					id: bankTransactions.id,
					date: bankTransactions.bookingDate,
					amount: bankTransactions.amount,
					counterpartName: bankTransactions.counterpartName,
					purpose: bankTransactions.purpose,
					bankAccount: bankAccounts.name,
					ledgerNumber: bankAccounts.ledgerNumber
				})
				.from(bankTransactions)
				.innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
				.where(inPeriod)
				.orderBy(asc(bankTransactions.bookingDate), asc(bankTransactions.createdAt)),
			db
				.select({ id: contraAccounts.id, number: contraAccounts.number })
				.from(contraAccounts)
				.where(eq(contraAccounts.accountId, accountId)),
			part(payments),
			db
				.select({
					bankTransactionId: bankTransactions.id,
					amount: depositTransactions.amount,
					contraAccountId: depositTransactions.contraAccountId
				})
				.from(depositTransactions)
				.innerJoin(bankTransactions, eq(depositTransactions.bankTransactionId, bankTransactions.id))
				.where(and(eq(depositTransactions.accountId, accountId), inPeriod)),
			part(expenses),
			part(otherBookings)
		]);
	const numbers = new Map(contra.map((row) => [row.id, row.number]));
	const parts = new Map<string, { amount: number; contraAccountId: string | null }[]>();
	for (const row of [...paymentParts, ...depositParts, ...expenseParts, ...otherParts]) {
		const list = parts.get(row.bankTransactionId) ?? [];
		list.push(row);
		parts.set(row.bankTransactionId, list);
	}
	const bookings: DatevBooking[] = [];
	const skipped: DatevSkipped[] = [];
	for (const transaction of transactions) {
		const own = parts.get(transaction.id) ?? [];
		const skip = (reason: DatevGap) =>
			skipped.push({
				id: transaction.id,
				date: transaction.date,
				amount: transaction.amount,
				counterpartName: transaction.counterpartName,
				bankAccount: transaction.bankAccount,
				reason
			});
		if (!valid(transaction.ledgerNumber)) {
			skip('no-ledger-number');
			continue;
		}
		if (own.length === 0 || own.some((row) => !row.contraAccountId)) {
			skip('no-contra-account');
			continue;
		}
		const contraNumbers = own.map((row) => numbers.get(row.contraAccountId!));
		if (!contraNumbers.every(valid)) {
			skip('no-contra-number');
			continue;
		}
		// The parts hold amounts as the bookkeeping sees them; the bank's sign says Soll or Haben.
		const sign = transaction.amount < 0 ? -1 : 1;
		const text = [transaction.counterpartName, transaction.purpose].filter(Boolean).join(' ');
		own.forEach((row, index) =>
			bookings.push({
				date: transaction.date,
				amount: sign * Math.abs(row.amount),
				account: transaction.ledgerNumber!,
				contraAccount: contraNumbers[index] as string,
				text
			})
		);
	}
	const used = bookings.flatMap((booking) => [booking.account, booking.contraAccount]);
	const { length, uneven } = accountLengthOf(used);
	return { bookings, skipped, accountLength: length, uneven };
}

/** The Buchungsstapel file in Windows-1252, for the period within one calendar year. */
export function datevFile(
	numbers: { advisorNumber: string; clientNumber: string },
	data: DatevExport,
	from: string,
	to: string,
	createdAt = new Date()
): Uint8Array<ArrayBuffer> {
	const text = datevBuchungsstapel(
		{
			advisorNumber: numbers.advisorNumber,
			clientNumber: numbers.clientNumber,
			fiscalYearStart: `${from.slice(0, 4)}-01-01`,
			accountLength: data.accountLength,
			from,
			to,
			label: `Bank ${from.slice(0, 4)}`,
			createdAt
		},
		data.bookings
	);
	return windows1252(text);
}

export function datevFilename(from: string, to: string): string {
	return `EXTF_Buchungsstapel_${from.replaceAll('-', '')}_${to.replaceAll('-', '')}.csv`;
}
