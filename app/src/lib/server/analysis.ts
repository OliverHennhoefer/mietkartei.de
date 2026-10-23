import { eq } from 'drizzle-orm';
import { dayOf, monthOf, today, type IsoDate } from '../dates';
import { analyse, type Analysis } from '../domain/analysis';
import type { Database } from './db';
import {
	depositTransactions,
	expenses,
	leases,
	leaseUnits,
	payments,
	properties,
	rentCharges,
	units
} from './db/schema';
import { listBalances } from './ledger';

// Loads the rows of the Auswertung and hands them to the domain. A fixed number of queries,
// whatever the account holds: the balances (which sync the rent charges first), then properties,
// units, leases, extra units, charges, payments, expenses and deposit movements.

export type AnalysisPage = Analysis & {
	/** Rückstand today of the leases in view. */
	arrears: number;
	/** The years with data, newest first, for the year select. */
	years: number[];
	/** Every property, for the property select. */
	propertyOptions: { id: string; name: string }[];
};

/** One calendar year, or everything from the first year with data to the current one. */
export type AnalysisPeriod = number | 'all';

export async function loadAnalysis(
	db: Database,
	accountId: string,
	options: { period: AnalysisPeriod; propertyId: string | null; today?: IsoDate }
): Promise<AnalysisPage> {
	const date = options.today ?? today();
	const balances = await listBalances(db, accountId, { untilMonth: monthOf(date), asOf: date });
	const [
		propertyRows,
		unitRows,
		leaseRows,
		extraRows,
		chargeRows,
		paymentRows,
		expenseRows,
		depositRows
	] = await Promise.all([
		db
			.select({ id: properties.id, name: properties.name })
			.from(properties)
			.where(eq(properties.accountId, accountId))
			.orderBy(properties.name),
		db
			.select({
				id: units.id,
				propertyId: units.propertyId,
				name: units.name,
				floorArea: units.floorArea,
				createdAt: units.createdAt
			})
			.from(units)
			.where(eq(units.accountId, accountId))
			.orderBy(units.name),
		db
			.select({
				id: leases.id,
				unitId: leases.unitId,
				startDate: leases.startDate,
				endDate: leases.endDate
			})
			.from(leases)
			.where(eq(leases.accountId, accountId)),
		db
			.select({ leaseId: leaseUnits.leaseId, unitId: leaseUnits.unitId })
			.from(leaseUnits)
			.where(eq(leaseUnits.accountId, accountId)),
		db
			.select({
				leaseId: rentCharges.leaseId,
				period: rentCharges.period,
				kind: rentCharges.kind,
				baseRent: rentCharges.baseRent,
				amount: rentCharges.amount
			})
			.from(rentCharges)
			.where(eq(rentCharges.accountId, accountId)),
		db
			.select({ leaseId: payments.leaseId, date: payments.date, amount: payments.amount })
			.from(payments)
			.where(eq(payments.accountId, accountId)),
		db
			.select({
				id: expenses.id,
				date: expenses.date,
				amount: expenses.amount,
				category: expenses.category,
				propertyId: expenses.propertyId,
				unitId: expenses.unitId,
				description: expenses.description
			})
			.from(expenses)
			.where(eq(expenses.accountId, accountId)),
		db
			.select({ leaseId: depositTransactions.leaseId, amount: depositTransactions.amount })
			.from(depositTransactions)
			.where(eq(depositTransactions.accountId, accountId))
	]);

	// A unit counts for vacancy from its creation, or from its first lease when that is earlier
	// (a lease entered for a unit created today that started years ago).
	const firstLease = new Map<string, IsoDate>();
	const extraByLease = new Map<string, string[]>();
	for (const row of extraRows) {
		const list = extraByLease.get(row.leaseId);
		if (list) list.push(row.unitId);
		else extraByLease.set(row.leaseId, [row.unitId]);
	}
	for (const lease of leaseRows) {
		for (const unitId of [lease.unitId, ...(extraByLease.get(lease.id) ?? [])]) {
			const first = firstLease.get(unitId);
			if (!first || lease.startDate < first) firstLease.set(unitId, lease.startDate);
		}
	}

	const currentYear = Number(date.slice(0, 4));
	// A loop, not Math.min(...rows): an account may have more payments than a call takes arguments.
	let firstYear = currentYear;
	for (const day of [
		...leaseRows.map((lease) => lease.startDate),
		...paymentRows.map((payment) => payment.date),
		...expenseRows.map((expense) => expense.date)
	]) {
		firstYear = Math.min(firstYear, Number(day.slice(0, 4)));
	}
	const years: number[] = [];
	for (let year = currentYear; year >= firstYear; year--) years.push(year);

	const all = options.period === 'all';
	const range = all
		? { start: `${firstYear}-01-01`, end: `${currentYear}-12-31` }
		: { start: `${options.period}-01-01`, end: `${options.period}-12-31` };

	const result = analyse(
		{
			properties: propertyRows,
			units: unitRows.map((unit) => {
				const created = dayOf(unit.createdAt);
				const first = firstLease.get(unit.id);
				return {
					id: unit.id,
					propertyId: unit.propertyId,
					name: unit.name,
					floorArea: unit.floorArea,
					since: first && first < created ? first : created
				};
			}),
			leases: leaseRows.map((lease) => ({
				...lease,
				extraUnitIds: extraByLease.get(lease.id) ?? []
			})),
			charges: chargeRows,
			payments: paymentRows,
			expenses: expenseRows,
			deposits: depositRows
		},
		{ range, propertyId: options.propertyId, granularity: all ? 'year' : 'month', today: date }
	);

	const unitsInView = new Set(result.units.map((unit) => unit.id));
	const leasesInView = new Set(
		leaseRows.filter((lease) => unitsInView.has(lease.unitId)).map((lease) => lease.id)
	);
	const arrears = balances
		.filter((balance) => leasesInView.has(balance.leaseId))
		.reduce((sum, balance) => sum + balance.overdue, 0);

	return { ...result, arrears, years, propertyOptions: propertyRows };
}
