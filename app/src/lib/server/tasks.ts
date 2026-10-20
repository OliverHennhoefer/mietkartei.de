import { and, asc, eq } from 'drizzle-orm';
import { formatDate } from '../dates';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { leases, properties, tasks, units } from './db/schema';

// Aufgaben: what the landlord writes down to do, optionally dated and linked to a property or a
// lease. The deadlines that follow from the data are computed in deadlines.ts, not stored here.

export type TaskInput = {
	title: string;
	dueDate: string | null;
	propertyId: string | null;
	leaseId: string | null;
	note: string | null;
};

export type TaskRow = typeof tasks.$inferSelect;

export type Task = TaskRow & {
	/** The linked property, when the link still exists. */
	property: { id: string; name: string } | null;
	/** The linked lease with its label ("EG links · Haus"), when the link still exists. */
	lease: { id: string; label: string } | null;
};

export type TaskError = 'unknown-property' | 'unknown-lease' | 'missing';

/** The task's label for audit summaries. */
function describe(task: { title: string; dueDate: string | null }): string {
	return task.dueDate ? `„${task.title}“ (bis ${formatDate(task.dueDate)})` : `„${task.title}“`;
}

async function decorate(db: Database, accountId: string, rows: TaskRow[]): Promise<Task[]> {
	if (rows.length === 0) return [];
	// Two queries for the labels, however many tasks there are.
	const [propertyRows, leaseRows] = await Promise.all([
		db
			.select({ id: properties.id, name: properties.name })
			.from(properties)
			.where(eq(properties.accountId, accountId)),
		db
			.select({ id: leases.id, unitName: units.name, propertyName: properties.name })
			.from(leases)
			.innerJoin(units, eq(leases.unitId, units.id))
			.innerJoin(properties, eq(units.propertyId, properties.id))
			.where(eq(leases.accountId, accountId))
	]);
	const propertyById = new Map(propertyRows.map((row) => [row.id, row]));
	const leaseById = new Map(
		leaseRows.map((row) => [row.id, { id: row.id, label: `${row.unitName} · ${row.propertyName}` }])
	);
	return rows.map((row) => ({
		...row,
		property: (row.propertyId && propertyById.get(row.propertyId)) || null,
		lease: (row.leaseId && leaseById.get(row.leaseId)) || null
	}));
}

/** Open tasks by due date (undated last), done tasks by completion, newest first. */
export async function listTasks(
	db: Database,
	accountId: string
): Promise<{ open: Task[]; done: Task[] }> {
	const rows = await db
		.select()
		.from(tasks)
		.where(eq(tasks.accountId, accountId))
		.orderBy(asc(tasks.createdAt));
	const all = await decorate(db, accountId, rows);
	const open = all
		.filter((task) => !task.done)
		.sort((a, b) => {
			if (a.dueDate === b.dueDate) return a.createdAt.getTime() - b.createdAt.getTime();
			if (a.dueDate === null) return 1;
			if (b.dueDate === null) return -1;
			return a.dueDate.localeCompare(b.dueDate);
		});
	const done = all
		.filter((task) => task.done)
		.sort((a, b) => (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0));
	return { open, done };
}

export async function getTask(
	db: Database,
	accountId: string,
	taskId: string
): Promise<Task | undefined> {
	const rows = await db
		.select()
		.from(tasks)
		.where(and(eq(tasks.accountId, accountId), eq(tasks.id, taskId)));
	const [task] = await decorate(db, accountId, rows);
	return task;
}

/** Links come from a select; whether they belong to the account is checked here, never trusted. */
async function checkLinks(
	db: Database,
	accountId: string,
	input: TaskInput
): Promise<TaskError | undefined> {
	if (input.propertyId) {
		const [property] = await db
			.select({ id: properties.id })
			.from(properties)
			.where(and(eq(properties.accountId, accountId), eq(properties.id, input.propertyId)));
		if (!property) return 'unknown-property';
	}
	if (input.leaseId) {
		const [lease] = await db
			.select({ id: leases.id })
			.from(leases)
			.where(and(eq(leases.accountId, accountId), eq(leases.id, input.leaseId)));
		if (!lease) return 'unknown-lease';
	}
	return undefined;
}

export async function createTask(
	db: Database,
	context: AuditContext,
	input: TaskInput
): Promise<{ ok: true; id: string } | { ok: false; reason: TaskError }> {
	const { accountId } = context;
	const reason = await checkLinks(db, accountId, input);
	if (reason) return { ok: false, reason };
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(tasks).values({ id, accountId, ...input }),
		auditEntry(db, context, 'task', id, 'create', `Aufgabe ${describe(input)} angelegt`)
	]);
	return { ok: true, id };
}

export async function updateTask(
	db: Database,
	context: AuditContext,
	taskId: string,
	input: TaskInput
): Promise<{ ok: true } | { ok: false; reason: TaskError }> {
	const { accountId } = context;
	const existing = await getTask(db, accountId, taskId);
	if (!existing) return { ok: false, reason: 'missing' };
	const reason = await checkLinks(db, accountId, input);
	if (reason) return { ok: false, reason };
	await runBatch(db, [
		db
			.update(tasks)
			.set(input)
			.where(and(eq(tasks.accountId, accountId), eq(tasks.id, taskId))),
		auditEntry(db, context, 'task', taskId, 'update', `Aufgabe ${describe(input)} geändert`)
	]);
	return { ok: true };
}

/** Marks the task done (with the time) or open again. False when the task is not in the account. */
export async function setDone(
	db: Database,
	context: AuditContext,
	taskId: string,
	done: boolean
): Promise<boolean> {
	const { accountId } = context;
	const existing = await getTask(db, accountId, taskId);
	if (!existing) return false;
	await runBatch(db, [
		db
			.update(tasks)
			.set({ done, doneAt: done ? new Date() : null })
			.where(and(eq(tasks.accountId, accountId), eq(tasks.id, taskId))),
		auditEntry(
			db,
			context,
			'task',
			taskId,
			'update',
			done
				? `Aufgabe ${describe(existing)} erledigt`
				: `Aufgabe ${describe(existing)} wieder geöffnet`
		)
	]);
	return true;
}

export async function deleteTask(
	db: Database,
	context: AuditContext,
	taskId: string
): Promise<boolean> {
	const { accountId } = context;
	const existing = await getTask(db, accountId, taskId);
	if (!existing) return false;
	await runBatch(db, [
		db.delete(tasks).where(and(eq(tasks.accountId, accountId), eq(tasks.id, taskId))),
		auditEntry(db, context, 'task', taskId, 'delete', `Aufgabe ${describe(existing)} gelöscht`)
	]);
	return true;
}
