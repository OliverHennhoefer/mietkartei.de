import { and, eq } from 'drizzle-orm';
import { addMonths, firstOfMonth, monthOf, type DateRange, type IsoDate } from '../dates';
import { returns, type Returns } from '../domain/returns';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { expenses, leases, payments, properties, rentCharges, taxYears, units } from './db/schema';
import { ensureCharges } from './ledger';

// Loads the rows of Rendite und Cashflow and hands them to the domain, and keeps what the page
// asks for beyond the bookings: the Anschaffungskosten (shared with the AfA of the Steuer tab) and
// the Darlehenssumme of each property.

/** The last twelve months up to today, or one calendar year. */
export type ReturnsWindow = 'last12' | number;

export type ReturnsPage = Returns & {
	range: DateRange;
	/** The years with bookings, newest first, for the window select. */
	years: number[];
	propertyOptions: { id: string; name: string }[];
};

export function windowRange(window: ReturnsWindow, date: IsoDate): DateRange {
	if (window === 'last12') return { start: addMonths(firstOfMonth(monthOf(date)), -11), end: date };
	const end = `${window}-12-31`;
	return { start: `${window}-01-01`, end: end < date ? end : date };
}

export async function loadReturns(
	db: Database,
	accountId: string,
	options: { window: ReturnsWindow; propertyId: string | null; today: IsoDate }
): Promise<ReturnsPage> {
	const leaseRows = await db
		.select({ id: leases.id, unitId: leases.unitId })
		.from(leases)
		.where(eq(leases.accountId, accountId));
	await ensureCharges(
		db,
		accountId,
		leaseRows.map((lease) => lease.id),
		monthOf(options.today)
	);
	const [propertyRows, unitRows, chargeRows, paymentRows, expenseRows, interestRows] =
		await Promise.all([
			db
				.select({
					id: properties.id,
					name: properties.name,
					acquisitionCost: properties.acquisitionCost,
					loanAmount: properties.loanAmount
				})
				.from(properties)
				.where(eq(properties.accountId, accountId))
				.orderBy(properties.name),
			db
				.select({ id: units.id, propertyId: units.propertyId })
				.from(units)
				.where(eq(units.accountId, accountId)),
			db
				.select({
					leaseId: rentCharges.leaseId,
					period: rentCharges.period,
					baseRent: rentCharges.baseRent
				})
				.from(rentCharges)
				.where(eq(rentCharges.accountId, accountId)),
			db
				.select({ leaseId: payments.leaseId, date: payments.date, amount: payments.amount })
				.from(payments)
				.where(eq(payments.accountId, accountId)),
			db
				.select({
					date: expenses.date,
					amount: expenses.amount,
					category: expenses.category,
					propertyId: expenses.propertyId
				})
				.from(expenses)
				.where(eq(expenses.accountId, accountId)),
			db
				.select({
					propertyId: taxYears.propertyId,
					year: taxYears.year,
					amount: taxYears.loanInterest
				})
				.from(taxYears)
				.where(eq(taxYears.accountId, accountId))
		]);

	const currentYear = Number(options.today.slice(0, 4));
	// A loop, not Math.min(...rows): an account may have more payments than a call takes arguments.
	let firstYear = currentYear;
	for (const row of [...paymentRows, ...expenseRows]) {
		firstYear = Math.min(firstYear, Number(row.date.slice(0, 4)));
	}
	const years: number[] = [];
	for (let year = currentYear; year >= firstYear; year--) years.push(year);

	const range = windowRange(options.window, options.today);
	const result = returns(
		{
			properties: propertyRows,
			units: unitRows,
			leases: leaseRows,
			charges: chargeRows,
			payments: paymentRows,
			expenses: expenseRows,
			interest: interestRows.flatMap((row) =>
				row.amount === null ? [] : [{ ...row, amount: row.amount }]
			)
		},
		{ range, propertyId: options.propertyId }
	);
	return {
		...result,
		range,
		years,
		propertyOptions: propertyRows.map(({ id, name }) => ({ id, name }))
	};
}

export type FinancingInput = { acquisitionCost: number | null; loanAmount: number | null };

/** Saves the Anschaffungskosten and the Darlehenssumme; false when the property is not there. */
export async function saveFinancing(
	db: Database,
	context: AuditContext,
	propertyId: string,
	input: FinancingInput
): Promise<boolean> {
	const { accountId } = context;
	const [property] = await db
		.select({ name: properties.name })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	if (!property) return false;
	await runBatch(db, [
		db
			.update(properties)
			.set(input)
			.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId))),
		auditEntry(
			db,
			context,
			'property',
			propertyId,
			'update',
			`Anschaffungskosten und Darlehen für Objekt ${property.name} geändert`
		)
	]);
	return true;
}
