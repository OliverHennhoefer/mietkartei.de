import { and, asc, count, eq, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { addMonths, formatDate, today as todayInBerlin, type IsoDate } from '../dates';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { leases, properties, tasks, units, type TaskCategory } from './db/schema';
import { assertQuota } from './quotas';

// Aufgaben: what the landlord writes down to do, optionally dated and linked to a property or a
// lease. The deadlines that follow from the data are computed in deadlines.ts, not stored here.
// A repeating task (maintenance, inspections, insurance) stays a single row per occurrence: done,
// it leaves an open copy due one interval later, so the done list keeps the history.

export type TaskInput = {
	title: string;
	category: TaskCategory;
	dueDate: string | null;
	repeatMonths: number | null;
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

/** The number of open tasks, for the dashboard tile. */
export async function countOpenTasks(db: Database, accountId: string): Promise<number> {
	const [row] = await db
		.select({ value: count() })
		.from(tasks)
		.where(and(eq(tasks.accountId, accountId), eq(tasks.done, false)));
	return row?.value ?? 0;
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
	await assertQuota(db, accountId, 'tasks');
	const reason = await checkLinks(db, accountId, input);
	if (reason) return { ok: false, reason };
	const id = crypto.randomUUID();
	await runBatch(db, [
		db
			.insert(tasks)
			.values({ id, accountId, ...input, repeatAnchor: input.repeatMonths ? input.dueDate : null }),
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
	// The series keeps its anchor while date and interval stay; a new date starts a new series.
	const sameSeries =
		existing.dueDate === input.dueDate && existing.repeatMonths === input.repeatMonths;
	const repeatAnchor = input.repeatMonths
		? (sameSeries && existing.repeatAnchor) || input.dueDate
		: null;
	await runBatch(db, [
		db
			.update(tasks)
			.set({ ...input, repeatAnchor })
			.where(and(eq(tasks.accountId, accountId), eq(tasks.id, taskId))),
		auditEntry(db, context, 'task', taskId, 'update', `Aufgabe ${describe(input)} geändert`)
	]);
	return { ok: true };
}

/**
 * The due date of the next occurrence: the first date of the series after the current due date,
 * and after today, so a task done late does not come back overdue. Dates are counted from the
 * series' anchor, so the 31st does not drift to the 28th.
 */
export function nextDueDate(
	anchor: IsoDate,
	dueDate: IsoDate,
	repeatMonths: number,
	today: IsoDate
): IsoDate {
	let steps = 1;
	let next = addMonths(anchor, repeatMonths);
	while (next <= dueDate || next <= today) {
		steps += 1;
		next = addMonths(anchor, repeatMonths * steps);
	}
	return next;
}

/**
 * Marks the task done (with the time) or open again. A repeating task done gets an open copy due
 * at the next date; reopening it removes that copy again while it is still open. False when the
 * task is not in the account.
 */
export async function setDone(
	db: Database,
	context: AuditContext,
	taskId: string,
	done: boolean,
	today: IsoDate = todayInBerlin()
): Promise<boolean> {
	const { accountId } = context;
	const existing = await getTask(db, accountId, taskId);
	if (!existing) return false;
	if (existing.done === done) return true;
	// Guarded by the state read above, so a second request racing this one changes nothing.
	const where = and(eq(tasks.accountId, accountId), eq(tasks.id, taskId), eq(tasks.done, !done));

	if (done) {
		const { dueDate: due, repeatMonths } = existing;
		if (!due || !repeatMonths) {
			await runBatch(db, [
				db.update(tasks).set({ done, doneAt: new Date() }).where(where),
				auditEntry(db, context, 'task', taskId, 'update', `Aufgabe ${describe(existing)} erledigt`)
			]);
			return true;
		}
		await assertQuota(db, accountId, 'tasks');
		const followUpId = crypto.randomUUID();
		const repeatAnchor = existing.repeatAnchor ?? due;
		const dueDate = nextDueDate(repeatAnchor, due, repeatMonths, today);
		const next = {
			title: existing.title,
			category: existing.category,
			dueDate,
			repeatMonths,
			repeatAnchor,
			propertyId: existing.propertyId,
			leaseId: existing.leaseId,
			note: existing.note
		};
		// The copy goes in first and out again unless this request's update was the one that
		// marked the task done, so two overlapping requests leave a single copy behind.
		const original = alias(tasks, 'original');
		await runBatch(db, [
			db.insert(tasks).values({ id: followUpId, accountId, ...next }),
			db.update(tasks).set({ done, doneAt: new Date(), followUpId }).where(where),
			db.delete(tasks).where(
				and(
					eq(tasks.id, followUpId),
					notExists(
						db
							.select({ one: sql`1` })
							.from(original)
							.where(and(eq(original.id, taskId), eq(original.followUpId, followUpId)))
					)
				)
			),
			auditEntry(
				db,
				context,
				'task',
				taskId,
				'update',
				`Aufgabe ${describe(existing)} erledigt; wieder fällig am ${formatDate(dueDate)}`
			)
		]);
		return true;
	}

	const [followUp] = existing.followUpId
		? await db
				.select({ id: tasks.id, done: tasks.done })
				.from(tasks)
				.where(and(eq(tasks.accountId, accountId), eq(tasks.id, existing.followUpId)))
		: [];
	const removeFollowUp = followUp && !followUp.done;
	await runBatch(db, [
		db.update(tasks).set({ done, doneAt: null, followUpId: null }).where(where),
		...(removeFollowUp
			? [db.delete(tasks).where(and(eq(tasks.accountId, accountId), eq(tasks.id, followUp.id)))]
			: []),
		auditEntry(
			db,
			context,
			'task',
			taskId,
			'update',
			removeFollowUp
				? `Aufgabe ${describe(existing)} wieder geöffnet; die nächste Fälligkeit entfällt`
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
