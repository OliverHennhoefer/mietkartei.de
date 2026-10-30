import { and, count, eq, max, sum } from 'drizzle-orm';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { expenses, serviceProviders, tasks } from './db/schema';
import { assertQuota } from './quotas';

// Dienstleister: the firms and people the landlord hires, from the plumber to the
// Hausmeisterdienst. A task names the one who does the job and an expense the one who was paid;
// both are optional ("unbekannt" without). Deleting a Dienstleister keeps the tasks and expenses
// and only clears the name there.

export type ServiceProviderInput = {
	name: string;
	service: string | null;
	phone: string | null;
	email: string | null;
	note: string | null;
};

export type ServiceProvider = typeof serviceProviders.$inferSelect;

export type ServiceProviderRow = ServiceProvider & {
	taskCount: number;
	/** The expenses that name the Dienstleister: how many, their sum and the latest date. */
	expenses: { count: number; total: number; lastDate: string | null };
};

/** By name, each with the number of tasks and the expenses that name them. Three queries. */
export async function listServiceProviders(
	db: Database,
	accountId: string
): Promise<ServiceProviderRow[]> {
	const [rows, taskCounts, expenseRows] = await Promise.all([
		db.select().from(serviceProviders).where(eq(serviceProviders.accountId, accountId)),
		db
			.select({ serviceProviderId: tasks.serviceProviderId, value: count() })
			.from(tasks)
			.where(eq(tasks.accountId, accountId))
			.groupBy(tasks.serviceProviderId),
		db
			.select({
				serviceProviderId: expenses.serviceProviderId,
				count: count(),
				total: sum(expenses.amount),
				lastDate: max(expenses.date)
			})
			.from(expenses)
			.where(eq(expenses.accountId, accountId))
			.groupBy(expenses.serviceProviderId)
	]);
	const tasksById = new Map(taskCounts.map((row) => [row.serviceProviderId, row.value]));
	const expensesById = new Map(
		expenseRows.map((row) => [
			row.serviceProviderId,
			{ count: row.count, total: Number(row.total ?? 0), lastDate: row.lastDate }
		])
	);
	return rows
		.map((row) => ({
			...row,
			taskCount: tasksById.get(row.id) ?? 0,
			expenses: expensesById.get(row.id) ?? { count: 0, total: 0, lastDate: null }
		}))
		.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** The entries of a Dienstleister select: the name, with the Leistung when there is one. */
export async function serviceProviderOptions(
	db: Database,
	accountId: string
): Promise<{ id: string; name: string }[]> {
	const rows = await db
		.select({
			id: serviceProviders.id,
			name: serviceProviders.name,
			service: serviceProviders.service
		})
		.from(serviceProviders)
		.where(eq(serviceProviders.accountId, accountId));
	return rows
		.sort((a, b) => a.name.localeCompare(b.name, 'de'))
		.map((row) => ({ id: row.id, name: row.service ? `${row.name} (${row.service})` : row.name }));
}

export async function getServiceProvider(
	db: Database,
	accountId: string,
	serviceProviderId: string
): Promise<ServiceProvider | undefined> {
	const [row] = await db
		.select()
		.from(serviceProviders)
		.where(
			and(eq(serviceProviders.accountId, accountId), eq(serviceProviders.id, serviceProviderId))
		);
	return row;
}

export async function createServiceProvider(
	db: Database,
	context: AuditContext,
	input: ServiceProviderInput
): Promise<string> {
	const { accountId } = context;
	await assertQuota(db, accountId, 'serviceProviders');
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(serviceProviders).values({ id, accountId, ...input }),
		auditEntry(
			db,
			context,
			'serviceProvider',
			id,
			'create',
			`Dienstleister „${input.name}“ angelegt`
		)
	]);
	return id;
}

/** False when the Dienstleister is not in the account. */
export async function updateServiceProvider(
	db: Database,
	context: AuditContext,
	serviceProviderId: string,
	input: ServiceProviderInput
): Promise<boolean> {
	const { accountId } = context;
	if (!(await getServiceProvider(db, accountId, serviceProviderId))) return false;
	await runBatch(db, [
		db
			.update(serviceProviders)
			.set(input)
			.where(
				and(eq(serviceProviders.accountId, accountId), eq(serviceProviders.id, serviceProviderId))
			),
		auditEntry(
			db,
			context,
			'serviceProvider',
			serviceProviderId,
			'update',
			`Dienstleister „${input.name}“ geändert`
		)
	]);
	return true;
}

/**
 * Deletes the Dienstleister and clears the name on the tasks and expenses. False when not in the
 * account.
 */
export async function deleteServiceProvider(
	db: Database,
	context: AuditContext,
	serviceProviderId: string
): Promise<boolean> {
	const { accountId } = context;
	const existing = await getServiceProvider(db, accountId, serviceProviderId);
	if (!existing) return false;
	await runBatch(db, [
		db
			.update(tasks)
			.set({ serviceProviderId: null })
			.where(and(eq(tasks.accountId, accountId), eq(tasks.serviceProviderId, serviceProviderId))),
		db
			.update(expenses)
			.set({ serviceProviderId: null })
			.where(
				and(eq(expenses.accountId, accountId), eq(expenses.serviceProviderId, serviceProviderId))
			),
		db
			.delete(serviceProviders)
			.where(
				and(eq(serviceProviders.accountId, accountId), eq(serviceProviders.id, serviceProviderId))
			),
		auditEntry(
			db,
			context,
			'serviceProvider',
			serviceProviderId,
			'delete',
			`Dienstleister „${existing.name}“ gelöscht`
		)
	]);
	return true;
}
