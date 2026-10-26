import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { today, type IsoDate, type IsoMonth } from '../dates';
import { total } from '../domain/rents';
import { periodLabel, type LeaseStatement } from '../domain/statement';
import type { Database } from './db';
import { chunkIds } from './db/batch';
import {
	auditLog,
	depositTransactions,
	documents,
	expenses,
	payments,
	operatingCostStatements,
	paymentReminders,
	rentCharges,
	statementResults,
	tasks,
	users,
	type ExpenseCategory,
	type ReminderLevel
} from './db/schema';
import { depositSummary } from './deposits';
import { leaseLabel, type LeaseSummary } from './leases';
import { listBalances } from './ledger';

// The tenant page as a dossier: what matters today (where the tenant lives, what they pay, what
// is open), then the money over the whole tenancy and everything else that belongs to the tenant,
// across all their leases. A fixed number of queries per group of leases, whatever the tenancy's
// length.

/** Expenses on the rented unit that the tenancy can cause; financing and WEG fees are left out. */
const unitCostCategories: readonly ExpenseCategory[] = [
	'maintenance',
	'operating_costs',
	'management',
	'modernization',
	'other'
];

const RECENT = 5;
const HISTORY = 10;

export type DossierLease = {
	id: string;
	label: string;
	startDate: IsoDate;
	endDate: IsoDate | null;
	active: boolean;
	upcoming: boolean;
	/** Warmmiete today, or the initial rent before the lease starts. */
	rent: number;
	charged: number;
	paid: number;
	/** charged − paid; positive = owed, negative = Guthaben. */
	balance: number;
	overdue: number;
	openSince: IsoMonth | null;
	depositAgreed: number;
	depositHeld: number;
	depositOutstanding: number;
};

export type DossierFinances = {
	/** Sollstellungen of all leases: rent, statement results, CO₂ shares, corrections. */
	charged: number;
	/** Money received minus refunds. */
	paid: number;
	balance: number;
	overdue: number;
	openSince: IsoMonth | null;
	lastPaymentDate: IsoDate | null;
	/** Sum of the statement results: positive = Nachzahlungen, negative = Guthaben. */
	statementBalance: number;
	/** Expenses booked on the rented units while the tenant lived there. */
	unitCosts: number;
	/** paid − unitCosts: what the tenancy brought in after the costs on the unit. */
	net: number;
	depositHeld: number;
	depositOutstanding: number;
};

export type TenantDossier = {
	leases: DossierLease[];
	finances: DossierFinances;
	payments: { id: string; leaseId: string; date: IsoDate; amount: number; note: string | null }[];
	statements: {
		statementId: string;
		leaseId: string;
		label: string;
		/** What the statement claims: positive = Nachzahlung, negative = Guthaben. */
		amount: number;
	}[];
	unitCosts: {
		id: string;
		date: IsoDate;
		amount: number;
		category: ExpenseCategory;
		description: string;
	}[];
	reminders: {
		id: string;
		leaseId: string;
		level: ReminderLevel;
		date: IsoDate;
		amount: number;
	}[];
	openTasks: { id: string; title: string; dueDate: IsoDate | null }[];
	documents: { id: string; name: string; createdAt: Date }[];
	history: { id: string; at: Date; summary: string; userName: string | null }[];
};

/** Whether `date` falls into the lease term, up to `asOf` for a lease without an end. */
function inTerm(
	lease: { startDate: IsoDate; endDate: IsoDate | null },
	date: IsoDate,
	asOf: IsoDate
) {
	const end = lease.endDate && lease.endDate < asOf ? lease.endDate : asOf;
	return date >= lease.startDate && date <= end;
}

export async function tenantDossier(
	db: Database,
	accountId: string,
	tenantId: string,
	leases: readonly LeaseSummary[],
	asOf: IsoDate = today()
): Promise<TenantDossier> {
	const leaseIds = leases.map((lease) => lease.id);
	const groups = chunkIds(leaseIds);
	const unitIds = [
		...new Set(
			leases.flatMap((lease) => [lease.unitId, ...lease.extraUnits.map((unit) => unit.id)])
		)
	];
	const inLeases = <T>(query: (ids: string[]) => Promise<T[]>) =>
		Promise.all(groups.map(query)).then((rows) => rows.flat());

	const [
		balances,
		paymentRows,
		statementRows,
		depositRows,
		reminderRows,
		taskRows,
		expenseRows,
		documentRows,
		historyRows,
		resultRows,
		correctionRows
	] = await Promise.all([
		leaseIds.length ? listBalances(db, accountId, { asOf, leaseIds }) : Promise.resolve([]),
		inLeases((ids) =>
			db
				.select()
				.from(payments)
				.where(and(eq(payments.accountId, accountId), inArray(payments.leaseId, ids)))
		),
		inLeases((ids) =>
			db
				.select()
				.from(rentCharges)
				.where(
					and(
						eq(rentCharges.accountId, accountId),
						eq(rentCharges.kind, 'statement_balance'),
						inArray(rentCharges.leaseId, ids)
					)
				)
		),
		inLeases((ids) =>
			db
				.select()
				.from(depositTransactions)
				.where(
					and(
						eq(depositTransactions.accountId, accountId),
						inArray(depositTransactions.leaseId, ids)
					)
				)
		),
		inLeases((ids) =>
			db
				.select()
				.from(paymentReminders)
				.where(
					and(eq(paymentReminders.accountId, accountId), inArray(paymentReminders.leaseId, ids))
				)
		),
		inLeases((ids) =>
			db
				.select()
				.from(tasks)
				.where(
					and(eq(tasks.accountId, accountId), eq(tasks.done, false), inArray(tasks.leaseId, ids))
				)
		),
		Promise.all(
			chunkIds(unitIds).map((ids) =>
				db
					.select()
					.from(expenses)
					.where(
						and(
							eq(expenses.accountId, accountId),
							inArray(expenses.unitId, ids),
							inArray(expenses.category, [...unitCostCategories])
						)
					)
			)
		).then((rows) => rows.flat()),
		// Documents filed under the tenant or under one of the leases; one query per group.
		Promise.all(
			(groups.length ? groups : [[]]).map((ids) =>
				db
					.select({ id: documents.id, name: documents.name, createdAt: documents.createdAt })
					.from(documents)
					.where(
						and(
							eq(documents.accountId, accountId),
							ids.length
								? or(eq(documents.tenantId, tenantId), inArray(documents.leaseId, ids))
								: eq(documents.tenantId, tenantId)
						)
					)
			)
		).then((rows) => rows.flat()),
		Promise.all(
			(groups.length ? groups : [[]]).map((ids) =>
				db
					.select({
						id: auditLog.id,
						at: auditLog.at,
						summary: auditLog.summary,
						userName: users.name,
						userEmail: users.email
					})
					.from(auditLog)
					.leftJoin(users, eq(auditLog.userId, users.id))
					.where(
						and(
							eq(auditLog.accountId, accountId),
							or(
								and(eq(auditLog.entity, 'tenant'), eq(auditLog.entityId, tenantId)),
								ids.length
									? and(eq(auditLog.entity, 'lease'), inArray(auditLog.entityId, ids))
									: undefined
							)
						)
					)
					.orderBy(desc(auditLog.at))
					.limit(HISTORY)
			)
		).then((rows) => rows.flat()),
		inLeases((ids) =>
			db
				.select({
					statementId: statementResults.statementId,
					leaseId: statementResults.leaseId,
					balance: statementResults.balance,
					result: statementResults.result,
					periodStart: operatingCostStatements.periodStart,
					periodEnd: operatingCostStatements.periodEnd
				})
				.from(statementResults)
				.innerJoin(
					operatingCostStatements,
					eq(statementResults.statementId, operatingCostStatements.id)
				)
				.where(
					and(
						eq(statementResults.accountId, accountId),
						eq(operatingCostStatements.status, 'approved'),
						inArray(statementResults.leaseId, ids)
					)
				)
		),
		// The statements an approved correction replaces.
		db
			.select({ correctsId: operatingCostStatements.correctsId })
			.from(operatingCostStatements)
			.where(
				and(
					eq(operatingCostStatements.accountId, accountId),
					eq(operatingCostStatements.status, 'approved'),
					isNotNull(operatingCostStatements.correctsId)
				)
			)
	]);

	const balanceByLease = new Map(balances.map((balance) => [balance.leaseId, balance]));
	const dossierLeases = leases.map((lease): DossierLease => {
		const balance = balanceByLease.get(lease.id);
		const deposit = depositSummary(
			depositRows.filter((row) => row.leaseId === lease.id),
			lease.securityDeposit
		);
		return {
			id: lease.id,
			label: leaseLabel(lease),
			startDate: lease.startDate,
			endDate: lease.endDate,
			active: lease.active,
			upcoming: lease.upcoming,
			rent: total(lease.currentRent),
			charged: balance?.charged ?? 0,
			paid: balance?.paid ?? 0,
			balance: balance?.balance ?? 0,
			overdue: balance?.overdue ?? 0,
			openSince: balance?.openSince ?? null,
			depositAgreed: lease.securityDeposit,
			depositHeld: deposit.held,
			// What is still to pay in only matters while the lease runs.
			depositOutstanding: lease.active || lease.upcoming ? deposit.outstanding : 0
		};
	});

	// What each approved, not corrected statement claims from the tenant: the frozen result (less
	// after the deadline), less what a late delivery took back. The ledger posting is not the
	// claim, it leaves out the unpaid prepayments that are already charged on the rent account.
	const corrected = new Set(correctionRows.map((row) => row.correctsId));
	const chargeById = new Map(statementRows.map((row) => [row.id, row]));
	const statements = resultRows
		.filter((row) => !corrected.has(row.statementId))
		.map((row) => {
			const frozen = JSON.parse(row.result) as Pick<LeaseStatement, 'posted'>;
			const takenBack = statementRows
				.filter(
					(charge) =>
						charge.referenceId === row.statementId &&
						charge.leaseId === row.leaseId &&
						charge.reversesChargeId !== null &&
						chargeById.get(charge.reversesChargeId)?.referenceId === row.statementId
				)
				.reduce((sum, charge) => sum + charge.amount, 0);
			return {
				statementId: row.statementId,
				leaseId: row.leaseId,
				label: `Betriebskostenabrechnung ${periodLabel(row.periodStart, row.periodEnd)}`,
				amount: (frozen.posted ?? row.balance) + takenBack,
				periodEnd: row.periodEnd
			};
		})
		.sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : 0))
		.map(({ statementId, leaseId, label, amount }) => ({ statementId, leaseId, label, amount }));

	// An expense counts when it falls into the term of a lease on its unit; counted once even when
	// two leases of the tenant cover the same day.
	const unitCosts = expenseRows
		.filter((expense) =>
			leases.some(
				(lease) =>
					(lease.unitId === expense.unitId ||
						lease.extraUnits.some((unit) => unit.id === expense.unitId)) &&
					inTerm(lease, expense.date, asOf)
			)
		)
		.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
		.map((expense) => ({
			id: expense.id,
			date: expense.date,
			amount: expense.amount,
			category: expense.category,
			description: expense.description
		}));

	const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);
	const paid = sum(dossierLeases.map((lease) => lease.paid));
	const unitCostTotal = sum(unitCosts.map((expense) => expense.amount));
	const openSince =
		dossierLeases
			.map((lease) => lease.openSince)
			.filter((month): month is IsoMonth => month !== null)
			.sort()[0] ?? null;
	const lastPaymentDate =
		balances
			.map((balance) => balance.lastPaymentDate)
			.filter((date): date is IsoDate => date !== null)
			.sort()
			.at(-1) ?? null;

	const byDateDesc = <T extends { date: string; createdAt: Date }>(a: T, b: T) =>
		a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.getTime() - a.createdAt.getTime();
	const uniqueDocuments = [...new Map(documentRows.map((row) => [row.id, row])).values()].sort(
		(a, b) => b.createdAt.getTime() - a.createdAt.getTime()
	);
	const history = [...new Map(historyRows.map((row) => [row.id, row])).values()]
		.sort((a, b) => b.at.getTime() - a.at.getTime())
		.slice(0, HISTORY)
		.map((row) => ({
			id: row.id,
			at: row.at,
			summary: row.summary,
			userName: row.userName || row.userEmail
		}));

	return {
		leases: dossierLeases,
		finances: {
			charged: sum(dossierLeases.map((lease) => lease.charged)),
			paid,
			balance: sum(dossierLeases.map((lease) => lease.balance)),
			overdue: sum(dossierLeases.map((lease) => lease.overdue)),
			openSince,
			lastPaymentDate,
			statementBalance: sum(statements.map((entry) => entry.amount)),
			unitCosts: unitCostTotal,
			net: paid - unitCostTotal,
			depositHeld: sum(dossierLeases.map((lease) => lease.depositHeld)),
			depositOutstanding: sum(dossierLeases.map((lease) => lease.depositOutstanding))
		},
		payments: [...paymentRows]
			.sort(byDateDesc)
			.slice(0, RECENT)
			.map((row) => ({
				id: row.id,
				leaseId: row.leaseId,
				date: row.date,
				amount: row.amount,
				note: row.note
			})),
		statements,
		unitCosts: unitCosts.slice(0, RECENT),
		reminders: [...reminderRows]
			.sort(byDateDesc)
			.slice(0, RECENT)
			.map((row) => ({
				id: row.id,
				leaseId: row.leaseId,
				level: row.level,
				date: row.date,
				amount: row.amount
			})),
		openTasks: taskRows
			.sort((a, b) => {
				if (a.dueDate === b.dueDate) return a.createdAt.getTime() - b.createdAt.getTime();
				if (a.dueDate === null) return 1;
				if (b.dueDate === null) return -1;
				return a.dueDate.localeCompare(b.dueDate);
			})
			.map((row) => ({ id: row.id, title: row.title, dueDate: row.dueDate })),
		// All of them: /dokumente filters by one link only and would miss the lease documents.
		documents: uniqueDocuments,
		history
	};
}
