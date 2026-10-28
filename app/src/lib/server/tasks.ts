import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	notExists,
	or,
	sql,
	sum
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { addMonths, formatDate, today as todayInBerlin, type IsoDate } from '../dates';
import { scopeLabels } from './expenses';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import {
	contractors,
	expenses,
	leases,
	properties,
	tasks,
	units,
	type TaskCategory
} from './db/schema';
import { assertQuota } from './quotas';

// Aufgaben: what the landlord writes down to do, optionally dated and linked to a property or a
// lease. The deadlines that follow from the data are computed in deadlines.ts, not stored here.
// A repeating task (maintenance, inspections, insurance) stays a single row per occurrence: done,
// it leaves an open copy due one interval later, so the done list keeps the history.
// A Reparatur names the Handwerker who does it, and the expenses that paid for it are linked to
// it, manual ones as well as those assigned from a bank transaction.

export type TaskInput = {
	title: string;
	category: TaskCategory;
	dueDate: string | null;
	repeatMonths: number | null;
	propertyId: string | null;
	leaseId: string | null;
	/** Left out (the API), a change keeps the Handwerker. */
	contractorId?: string | null;
	note: string | null;
};

export type TaskRow = typeof tasks.$inferSelect;

export type Task = TaskRow & {
	/** The linked property, when the link still exists. */
	property: { id: string; name: string } | null;
	/** The linked lease with its label ("EG links · Haus"), when the link still exists. */
	lease: { id: string; label: string } | null;
	/** The Handwerker, when one is named. */
	contractor: { id: string; name: string; phone: string | null } | null;
	/** The sum and number of the linked expenses. */
	costs: { total: number; count: number };
};

export type TaskError =
	'unknown-property' | 'unknown-lease' | 'unknown-contractor' | 'unknown-expense' | 'missing';

/** The task's label for audit summaries. */
function describe(task: { title: string; dueDate: string | null }): string {
	return task.dueDate ? `„${task.title}“ (bis ${formatDate(task.dueDate)})` : `„${task.title}“`;
}

async function decorate(db: Database, accountId: string, rows: TaskRow[]): Promise<Task[]> {
	if (rows.length === 0) return [];
	// Four queries for the labels and costs, however many tasks there are.
	const [propertyRows, leaseRows, contractorRows, costRows] = await Promise.all([
		db
			.select({ id: properties.id, name: properties.name })
			.from(properties)
			.where(eq(properties.accountId, accountId)),
		db
			.select({ id: leases.id, unitName: units.name, propertyName: properties.name })
			.from(leases)
			.innerJoin(units, eq(leases.unitId, units.id))
			.innerJoin(properties, eq(units.propertyId, properties.id))
			.where(eq(leases.accountId, accountId)),
		db
			.select({ id: contractors.id, name: contractors.name, phone: contractors.phone })
			.from(contractors)
			.where(eq(contractors.accountId, accountId)),
		db
			.select({
				taskId: expenses.taskId,
				total: sum(expenses.amount),
				count: sql<number>`count(*)`
			})
			.from(expenses)
			.where(and(eq(expenses.accountId, accountId), isNotNull(expenses.taskId)))
			.groupBy(expenses.taskId)
	]);
	const contractorById = new Map(contractorRows.map((row) => [row.id, row]));
	const costsByTask = new Map(
		costRows.map((row) => [row.taskId, { total: Number(row.total ?? 0), count: row.count }])
	);
	const propertyById = new Map(propertyRows.map((row) => [row.id, row]));
	const leaseById = new Map(
		leaseRows.map((row) => [row.id, { id: row.id, label: `${row.unitName} · ${row.propertyName}` }])
	);
	return rows.map((row) => ({
		...row,
		property: (row.propertyId && propertyById.get(row.propertyId)) || null,
		lease: (row.leaseId && leaseById.get(row.leaseId)) || null,
		contractor: (row.contractorId && contractorById.get(row.contractorId)) || null,
		costs: costsByTask.get(row.id) ?? { total: 0, count: 0 }
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
	if (input.contractorId) {
		const [contractor] = await db
			.select({ id: contractors.id })
			.from(contractors)
			.where(and(eq(contractors.accountId, accountId), eq(contractors.id, input.contractorId)));
		if (!contractor) return 'unknown-contractor';
	}
	return undefined;
}

export type TaskExpense = {
	id: string;
	date: IsoDate;
	amount: number;
	description: string;
	scopeLabel: string;
	fromBank: boolean;
};

/** How far back the expenses go that can still be linked to a task. */
const LINKABLE_YEARS = 3;

/**
 * The expenses linked to the task, and those that could be: Instandhaltung of the last three
 * years not linked to another task, of the task's property (the lease's, for a task of a lease)
 * when it has one. Newest first, at most 100 candidates.
 */
export async function taskExpenses(
	db: Database,
	accountId: string,
	task: Pick<TaskRow, 'id' | 'propertyId' | 'leaseId'>,
	today: IsoDate = todayInBerlin()
): Promise<{ linked: TaskExpense[]; candidates: TaskExpense[] }> {
	let propertyId = task.propertyId;
	if (!propertyId && task.leaseId) {
		const [lease] = await db
			.select({ propertyId: units.propertyId })
			.from(leases)
			.innerJoin(units, eq(leases.unitId, units.id))
			.where(and(eq(leases.accountId, accountId), eq(leases.id, task.leaseId)));
		propertyId = lease?.propertyId ?? null;
	}
	const columns = {
		id: expenses.id,
		date: expenses.date,
		amount: expenses.amount,
		description: expenses.description,
		propertyId: expenses.propertyId,
		unitId: expenses.unitId,
		bankTransactionId: expenses.bankTransactionId
	};
	const [linked, candidates, label] = await Promise.all([
		db
			.select(columns)
			.from(expenses)
			.where(and(eq(expenses.accountId, accountId), eq(expenses.taskId, task.id)))
			.orderBy(desc(expenses.date)),
		db
			.select(columns)
			.from(expenses)
			.where(
				and(
					eq(expenses.accountId, accountId),
					isNull(expenses.taskId),
					eq(expenses.category, 'maintenance'),
					gte(expenses.date, addMonths(today, -12 * LINKABLE_YEARS)),
					propertyId ? eq(expenses.propertyId, propertyId) : undefined
				)
			)
			.orderBy(desc(expenses.date), desc(expenses.createdAt))
			.limit(100),
		scopeLabels(db, accountId)
	]);
	const shape = (row: (typeof linked)[number]): TaskExpense => ({
		id: row.id,
		date: row.date,
		amount: row.amount,
		description: row.description,
		scopeLabel: label(row),
		fromBank: row.bankTransactionId !== null
	});
	return { linked: linked.map(shape), candidates: candidates.map(shape) };
}

/**
 * The statements that link exactly `expenseIds` to the task: each must be an expense of the
 * account not linked to another task. Undefined when one is not.
 */
async function expenseLinks(db: Database, accountId: string, taskId: string, expenseIds: string[]) {
	const ids = [...new Set(expenseIds)];
	if (ids.length > 0) {
		const rows = await db
			.select({ id: expenses.id })
			.from(expenses)
			.where(
				and(
					eq(expenses.accountId, accountId),
					inArray(expenses.id, ids),
					or(isNull(expenses.taskId), eq(expenses.taskId, taskId))
				)
			);
		if (rows.length !== ids.length) return undefined;
	}
	const ofTask = and(eq(expenses.accountId, accountId), eq(expenses.taskId, taskId));
	return [
		db.update(expenses).set({ taskId: null }).where(ofTask),
		...(ids.length > 0
			? [
					db
						.update(expenses)
						.set({ taskId })
						.where(
							and(
								eq(expenses.accountId, accountId),
								inArray(expenses.id, ids),
								or(isNull(expenses.taskId), eq(expenses.taskId, taskId))
							)
						)
				]
			: [])
	];
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

/** Changes the task and, with `expenseIds`, links exactly these expenses to it. */
export async function updateTask(
	db: Database,
	context: AuditContext,
	taskId: string,
	input: TaskInput,
	expenseIds?: string[]
): Promise<{ ok: true } | { ok: false; reason: TaskError }> {
	const { accountId } = context;
	const existing = await getTask(db, accountId, taskId);
	if (!existing) return { ok: false, reason: 'missing' };
	const reason = await checkLinks(db, accountId, input);
	if (reason) return { ok: false, reason };
	const links = expenseIds ? await expenseLinks(db, accountId, taskId, expenseIds) : [];
	if (!links) return { ok: false, reason: 'unknown-expense' };
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
		...links,
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
			contractorId: existing.contractorId,
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
			? [
					// Still open when the batch runs: a copy done in the meantime keeps its history.
					db
						.delete(tasks)
						.where(
							and(eq(tasks.accountId, accountId), eq(tasks.id, followUp.id), eq(tasks.done, false))
						)
				]
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
		// The expenses stay, only no longer linked.
		db
			.update(expenses)
			.set({ taskId: null })
			.where(and(eq(expenses.accountId, accountId), eq(expenses.taskId, taskId))),
		db.delete(tasks).where(and(eq(tasks.accountId, accountId), eq(tasks.id, taskId))),
		auditEntry(db, context, 'task', taskId, 'delete', `Aufgabe ${describe(existing)} gelöscht`)
	]);
	return true;
}
