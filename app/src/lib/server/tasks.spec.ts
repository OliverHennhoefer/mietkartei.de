import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { createServiceProvider, deleteServiceProvider } from './service-providers';
import { auditLog, expenses, tasks } from './db/schema';
import { createLease } from './leases';
import { QUOTAS } from './quotas';
import {
	createTask,
	deleteTask,
	getTask,
	listTasks,
	nextDueDate,
	setDone,
	taskExpenses,
	updateTask,
	type TaskInput
} from './tasks';
import { contextA, contextB, leaseInput, seedUnit, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

const input = (overrides: Partial<TaskInput> = {}): TaskInput => ({
	title: 'Rauchmelder prüfen',
	category: 'other',
	dueDate: null,
	repeatMonths: null,
	propertyId: null,
	leaseId: null,
	note: null,
	...overrides
});

async function audit(accountId: string) {
	const rows = await db.select().from(auditLog).where(eq(auditLog.accountId, accountId));
	return rows.map((row) => [row.entity, row.entityId, row.action, row.summary]);
}

describe('createTask', () => {
	it('stores the task with its links and writes an audit line', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'a', { propertyName: 'Haus' });
		const created = await createLease(db, contextA, leaseInput(unitId));
		if (!created.ok) throw new Error('lease');

		const result = await createTask(
			db,
			contextA,
			input({ dueDate: '2026-11-30', propertyId, leaseId: created.id, note: 'Alle Etagen' })
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const task = await getTask(db, 'a', result.id);
		expect(task).toMatchObject({
			accountId: 'a',
			title: 'Rauchmelder prüfen',
			dueDate: '2026-11-30',
			done: false,
			doneAt: null,
			note: 'Alle Etagen',
			property: { id: propertyId, name: 'Haus' },
			lease: { id: created.id, label: 'EG links · Haus' }
		});
		expect(await audit('a')).toEqual([
			['lease', created.id, 'create', 'Mietvertrag angelegt'],
			['task', result.id, 'create', 'Aufgabe „Rauchmelder prüfen“ (bis 30.11.2026) angelegt']
		]);
	});

	it('refuses a property or lease of another account', async () => {
		const { propertyId: foreignProperty, unitId } = await seedUnit(db, 'b');
		const foreignLease = await createLease(db, contextB, leaseInput(unitId));
		if (!foreignLease.ok) throw new Error('lease');

		expect(await createTask(db, contextA, input({ propertyId: foreignProperty }))).toEqual({
			ok: false,
			reason: 'unknown-property'
		});
		expect(await createTask(db, contextA, input({ leaseId: foreignLease.id }))).toEqual({
			ok: false,
			reason: 'unknown-lease'
		});
		expect(await db.select().from(tasks)).toEqual([]);
	});

	it('refuses a task above the account limit with 409', async () => {
		const limit = QUOTAS.tasks.max;
		QUOTAS.tasks.max = 0;
		try {
			const refusal = await createTask(db, contextA, input()).catch((e) => e);
			expect(isHttpError(refusal, 409)).toBe(true);
			expect(refusal.body.message).toContain('höchstens 0 Aufgaben');
		} finally {
			QUOTAS.tasks.max = limit;
		}
		expect(await db.select().from(tasks)).toEqual([]);
	});
});

describe('listTasks', () => {
	it('sorts open tasks by due date with undated ones last, done ones newest first', async () => {
		const later = await createTask(db, contextA, input({ title: 'Später', dueDate: '2026-12-01' }));
		const undated = await createTask(db, contextA, input({ title: 'Irgendwann' }));
		const soon = await createTask(db, contextA, input({ title: 'Bald', dueDate: '2026-10-01' }));
		const doneFirst = await createTask(db, contextA, input({ title: 'Erledigt 1' }));
		const doneSecond = await createTask(db, contextA, input({ title: 'Erledigt 2' }));
		if (!later.ok || !undated.ok || !soon.ok || !doneFirst.ok || !doneSecond.ok) return;
		await setDone(db, contextA, doneFirst.id, true);
		// doneAt is a timestamp; the second completion lands later even within one millisecond
		// only when forced, so set it explicitly.
		await setDone(db, contextA, doneSecond.id, true);
		await db
			.update(tasks)
			.set({ doneAt: new Date(Date.now() + 60_000) })
			.where(eq(tasks.id, doneSecond.id));

		const { open, done } = await listTasks(db, 'a');
		expect(open.map((task) => task.title)).toEqual(['Bald', 'Später', 'Irgendwann']);
		expect(done.map((task) => task.title)).toEqual(['Erledigt 2', 'Erledigt 1']);
	});

	it('keeps tasks due on the same day in the order they were created', async () => {
		const first = await createTask(db, contextA, input({ title: 'Zuerst', dueDate: '2026-10-01' }));
		const second = await createTask(
			db,
			contextA,
			input({ title: 'Danach', dueDate: '2026-10-01' })
		);
		const third = await createTask(
			db,
			contextA,
			input({ title: 'Zuletzt', dueDate: '2026-10-01' })
		);
		if (!first.ok || !second.ok || !third.ok) throw new Error('setup failed');
		// createdAt has millisecond resolution; spread the rows so the order is defined.
		const base = Date.now();
		for (const [index, id] of [third.id, first.id, second.id].entries()) {
			await db
				.update(tasks)
				.set({ createdAt: new Date(base + index * 1000) })
				.where(eq(tasks.id, id));
		}
		const { open } = await listTasks(db, 'a');
		expect(open.map((task) => task.title)).toEqual(['Zuletzt', 'Zuerst', 'Danach']);
	});

	it('does not leak into another account', async () => {
		const mine = await createTask(db, contextA, input({ title: 'Meine' }));
		const theirs = await createTask(db, contextB, input({ title: 'Fremde' }));
		if (!mine.ok || !theirs.ok) return;

		const { open, done } = await listTasks(db, 'a');
		expect(open.map((task) => task.title)).toEqual(['Meine']);
		expect(done).toEqual([]);
		expect(await getTask(db, 'a', theirs.id)).toBeUndefined();
		expect(await setDone(db, contextA, theirs.id, true)).toBe(false);
		expect(await deleteTask(db, contextA, theirs.id)).toBe(false);
		expect(await updateTask(db, contextA, theirs.id, input({ title: 'Gekapert' }))).toEqual({
			ok: false,
			reason: 'missing'
		});
		expect((await getTask(db, 'b', theirs.id))?.title).toBe('Fremde');
		expect((await getTask(db, 'b', theirs.id))?.done).toBe(false);
	});
});

describe('setDone, updateTask and deleteTask', () => {
	it('marks a task done and open again, with the time and an audit line each', async () => {
		const created = await createTask(db, contextA, input());
		if (!created.ok) return;

		expect(await setDone(db, contextA, created.id, true)).toBe(true);
		let task = await getTask(db, 'a', created.id);
		expect(task?.done).toBe(true);
		expect(task?.doneAt).toBeInstanceOf(Date);

		expect(await setDone(db, contextA, created.id, false)).toBe(true);
		task = await getTask(db, 'a', created.id);
		expect(task?.done).toBe(false);
		expect(task?.doneAt).toBeNull();

		expect((await audit('a')).map((entry) => entry[3])).toEqual([
			'Aufgabe „Rauchmelder prüfen“ angelegt',
			'Aufgabe „Rauchmelder prüfen“ erledigt',
			'Aufgabe „Rauchmelder prüfen“ wieder geöffnet'
		]);
	});

	it('updates the fields and clears a dropped link', async () => {
		const { propertyId } = await seedUnit(db, 'a');
		const created = await createTask(db, contextA, input({ propertyId }));
		if (!created.ok) return;

		expect(
			await updateTask(db, contextA, created.id, input({ title: 'Neu', dueDate: '2027-01-15' }))
		).toEqual({ ok: true });
		const task = await getTask(db, 'a', created.id);
		expect(task).toMatchObject({
			title: 'Neu',
			dueDate: '2027-01-15',
			propertyId: null,
			property: null
		});
		const { propertyId: foreignProperty } = await seedUnit(db, 'b');
		expect(
			await updateTask(db, contextA, created.id, input({ propertyId: foreignProperty }))
		).toEqual({ ok: false, reason: 'unknown-property' });
	});

	it('deletes the task and records it', async () => {
		const created = await createTask(db, contextA, input());
		if (!created.ok) return;
		expect(await deleteTask(db, contextA, created.id)).toBe(true);
		expect(await getTask(db, 'a', created.id)).toBeUndefined();
		expect(await deleteTask(db, contextA, created.id)).toBe(false);
		expect((await audit('a')).at(-1)).toEqual([
			'task',
			created.id,
			'delete',
			'Aufgabe „Rauchmelder prüfen“ gelöscht'
		]);
	});
});

describe('nextDueDate', () => {
	it('adds the interval to the due date', () => {
		expect(nextDueDate('2026-11-30', '2026-11-30', 12, '2026-11-20')).toBe('2027-11-30');
		expect(nextDueDate('2026-11-30', '2026-11-30', 3, '2026-12-01')).toBe('2027-02-28');
	});

	it('skips occurrences that have passed', () => {
		expect(nextDueDate('2024-01-31', '2024-01-31', 12, '2026-10-23')).toBe('2027-01-31');
		expect(nextDueDate('2026-10-23', '2026-10-23', 6, '2026-10-23')).toBe('2027-04-23');
	});

	it('counts from the anchor, so a shorter month does not move the series', () => {
		expect(nextDueDate('2026-01-31', '2026-02-28', 1, '2026-02-20')).toBe('2026-03-31');
		expect(nextDueDate('2024-02-29', '2025-02-28', 12, '2025-02-01')).toBe('2026-02-28');
		expect(nextDueDate('2024-02-29', '2027-02-28', 12, '2027-02-01')).toBe('2028-02-29');
	});
});

describe('setDone on a repeating task', () => {
	const repeating = () =>
		input({ category: 'inspection', dueDate: '2026-11-30', repeatMonths: 12, note: 'DIN 14676' });

	it('leaves an open copy due one interval later', async () => {
		const { propertyId } = await seedUnit(db, 'a');
		const created = await createTask(db, contextA, { ...repeating(), propertyId });
		if (!created.ok) return;

		expect(await setDone(db, contextA, created.id, true, '2026-11-25')).toBe(true);
		const { open, done } = await listTasks(db, 'a');
		expect(done.map((task) => task.id)).toEqual([created.id]);
		expect(open).toHaveLength(1);
		expect(open[0]).toMatchObject({
			title: 'Rauchmelder prüfen',
			category: 'inspection',
			dueDate: '2027-11-30',
			repeatMonths: 12,
			propertyId,
			note: 'DIN 14676',
			done: false
		});
		expect(done[0].followUpId).toBe(open[0].id);
		expect((await audit('a')).at(-1)?.[3]).toBe(
			'Aufgabe „Rauchmelder prüfen“ (bis 30.11.2026) erledigt; wieder fällig am 30.11.2027'
		);
	});

	it('removes the open copy again when the task is reopened', async () => {
		const created = await createTask(db, contextA, repeating());
		if (!created.ok) return;
		await setDone(db, contextA, created.id, true, '2026-11-25');

		expect(await setDone(db, contextA, created.id, false)).toBe(true);
		const { open, done } = await listTasks(db, 'a');
		expect(done).toEqual([]);
		expect(open.map((task) => [task.id, task.followUpId])).toEqual([[created.id, null]]);
		expect((await audit('a')).at(-1)?.[3]).toBe(
			'Aufgabe „Rauchmelder prüfen“ (bis 30.11.2026) wieder geöffnet; die nächste Fälligkeit entfällt'
		);
	});

	it('keeps a copy that was done already when the task is reopened', async () => {
		const created = await createTask(db, contextA, repeating());
		if (!created.ok) return;
		await setDone(db, contextA, created.id, true, '2026-11-25');
		const [followUp] = (await listTasks(db, 'a')).open;
		await setDone(db, contextA, followUp.id, true, '2027-11-25');

		await setDone(db, contextA, created.id, false);
		const { open, done } = await listTasks(db, 'a');
		expect(open.map((task) => task.dueDate)).toEqual(['2026-11-30', '2028-11-30']);
		expect(done.map((task) => task.id)).toEqual([followUp.id]);
	});

	it('keeps the day of month across copies', async () => {
		const created = await createTask(
			db,
			contextA,
			input({ dueDate: '2026-01-31', repeatMonths: 1, category: 'maintenance' })
		);
		if (!created.ok) return;
		await setDone(db, contextA, created.id, true, '2026-01-20');
		const [february] = (await listTasks(db, 'a')).open;
		expect(february.dueDate).toBe('2026-02-28');
		await setDone(db, contextA, february.id, true, '2026-02-20');
		expect((await listTasks(db, 'a')).open.map((task) => task.dueDate)).toEqual(['2026-03-31']);

		// A new due date starts a new series.
		const [march] = (await listTasks(db, 'a')).open;
		await updateTask(
			db,
			contextA,
			march.id,
			input({ dueDate: '2026-03-15', repeatMonths: 1, category: 'maintenance' })
		);
		expect((await getTask(db, 'a', march.id))?.repeatAnchor).toBe('2026-03-15');
	});

	it('leaves a single copy when two requests mark the task done at once', async () => {
		const created = await createTask(db, contextA, repeating());
		if (!created.ok) return;
		await Promise.all([
			setDone(db, contextA, created.id, true, '2026-11-25'),
			setDone(db, contextA, created.id, true, '2026-11-25')
		]);
		const { open, done } = await listTasks(db, 'a');
		expect(open).toHaveLength(1);
		expect(done[0].followUpId).toBe(open[0].id);
	});

	it('does nothing when the task is done already', async () => {
		const created = await createTask(db, contextA, repeating());
		if (!created.ok) return;
		await setDone(db, contextA, created.id, true, '2026-11-25');
		expect(await setDone(db, contextA, created.id, true, '2026-11-25')).toBe(true);
		expect((await listTasks(db, 'a')).open).toHaveLength(1);
	});

	it('refuses the copy when the task quota is reached', async () => {
		const created = await createTask(db, contextA, repeating());
		if (!created.ok) return;
		const original = QUOTAS.tasks.max;
		QUOTAS.tasks.max = 1;
		try {
			await expect(setDone(db, contextA, created.id, true, '2026-11-25')).rejects.toSatisfy(
				isHttpError
			);
		} finally {
			QUOTAS.tasks.max = original;
		}
		expect((await getTask(db, 'a', created.id))?.done).toBe(false);
	});
});

describe('Reparaturen', () => {
	const bill = (
		accountId: string,
		date: string,
		amount: number,
		overrides: Partial<typeof expenses.$inferInsert> = {}
	) =>
		db
			.insert(expenses)
			.values({
				accountId,
				date,
				amount,
				category: 'maintenance',
				description: `Rechnung ${amount}`,
				...overrides
			})
			.returning({ id: expenses.id })
			.then(([row]) => row.id);

	it('names the Dienstleister, refusing one of another account, and keeps it on the next occurrence', async () => {
		const plumber = await createServiceProvider(db, contextA, {
			name: 'Sanitär Wendt',
			service: 'Sanitär',
			phone: '030 1',
			email: null,
			note: null
		});
		const foreign = await createServiceProvider(db, contextB, {
			name: 'Fremd',
			service: null,
			phone: null,
			email: null,
			note: null
		});
		expect(await createTask(db, contextA, input({ serviceProviderId: foreign }))).toEqual({
			ok: false,
			reason: 'unknown-service-provider'
		});
		const created = await createTask(
			db,
			contextA,
			input({
				category: 'repair',
				serviceProviderId: plumber,
				dueDate: '2026-03-01',
				repeatMonths: 12
			})
		);
		if (!created.ok) throw new Error(created.reason);
		expect((await getTask(db, 'a', created.id))?.serviceProvider).toEqual({
			id: plumber,
			name: 'Sanitär Wendt',
			phone: '030 1'
		});
		await setDone(db, contextA, created.id, true, '2026-03-02');
		const { open } = await listTasks(db, 'a');
		expect(open[0].serviceProviderId).toBe(plumber);

		// Deleting the Dienstleister clears the name on both tasks.
		expect(await deleteServiceProvider(db, contextA, plumber)).toBe(true);
		expect((await listTasks(db, 'a')).open[0].serviceProvider).toBeNull();
	});

	it('links exactly the chosen expenses and sums them; deleting the task keeps them', async () => {
		const { propertyId } = await seedUnit(db, 'a', { propertyName: 'Haus' });
		const { propertyId: other } = await seedUnit(db, 'a', { propertyName: 'Anderes Haus' });
		const created = await createTask(db, contextA, input({ category: 'repair', propertyId }));
		if (!created.ok) throw new Error(created.reason);
		const second = await createTask(db, contextA, input({ title: 'Zweite' }));
		if (!second.ok) throw new Error(second.reason);
		const first = await bill('a', '2026-02-10', 12000, { propertyId });
		const late = await bill('a', '2026-03-01', 3000, { propertyId });
		await bill('a', '2026-03-01', 5000, { propertyId: other });
		await bill('a', '2026-03-01', 7000, { propertyId, category: 'modernization' });
		await bill('a', '2022-03-01', 9000, { propertyId });
		const taken = await bill('a', '2026-03-01', 1000, { propertyId, taskId: second.id });
		const foreign = await bill('b', '2026-03-01', 1000);

		const task = (await getTask(db, 'a', created.id))!;
		const same = input({ category: 'repair', propertyId });
		const choice = await taskExpenses(db, 'a', task, '2026-10-01');
		expect(choice.linked).toEqual([]);
		// Instandhaltung of the property in the last three years, not linked elsewhere.
		expect(choice.candidates.map((row) => row.id)).toEqual([late, first]);
		expect(choice.candidates[0]).toMatchObject({ scopeLabel: 'Haus', fromBank: false });

		for (const refused of [[foreign], [taken], ['unbekannt']]) {
			expect(await updateTask(db, contextA, created.id, same, refused)).toEqual({
				ok: false,
				reason: 'unknown-expense'
			});
		}
		expect(await updateTask(db, contextA, created.id, same, [first, late])).toEqual({
			ok: true
		});
		expect((await getTask(db, 'a', created.id))?.costs).toEqual({ total: 15000, count: 2 });
		// Without the expenses, the links stay; with one, only that one is linked.
		await updateTask(db, contextA, created.id, { ...same, title: 'Neu' });
		expect((await getTask(db, 'a', created.id))?.costs.count).toBe(2);
		await updateTask(db, contextA, created.id, same, [late]);
		expect((await taskExpenses(db, 'a', task, '2026-10-01')).linked.map((row) => row.id)).toEqual([
			late
		]);

		expect(await deleteTask(db, contextA, created.id)).toBe(true);
		const [kept] = await db.select().from(expenses).where(eq(expenses.id, late));
		expect(kept.taskId).toBeNull();
	});

	it('names the Dienstleister of the task on linked expenses that name none', async () => {
		const provider = (name: string) =>
			createServiceProvider(db, contextA, {
				name,
				service: null,
				phone: null,
				email: null,
				note: null
			});
		const roofer = await provider('Dachdeckerei Seifert');
		const plumber = await provider('Sanitär Wendt');
		const created = await createTask(db, contextA, input({ category: 'repair' }));
		if (!created.ok) throw new Error(created.reason);
		const unnamed = await bill('a', '2026-03-01', 1000);
		const named = await bill('a', '2026-03-02', 2000, { serviceProviderId: plumber });
		const providerOf = async (id: string) =>
			(await db.select().from(expenses).where(eq(expenses.id, id)))[0].serviceProviderId;
		// Without a Dienstleister on the task the expenses stay as they are.
		await updateTask(db, contextA, created.id, input({ category: 'repair' }), [unnamed]);
		expect(await providerOf(unnamed)).toBeNull();
		await updateTask(
			db,
			contextA,
			created.id,
			input({ category: 'repair', serviceProviderId: roofer }),
			[unnamed, named]
		);
		expect(await providerOf(unnamed)).toBe(roofer);
		expect(await providerOf(named)).toBe(plumber);
	});

	it('links more expenses than a statement may bind at once', async () => {
		const created = await createTask(db, contextA, input({ category: 'repair' }));
		if (!created.ok) throw new Error(created.reason);
		const ids = await Promise.all(
			Array.from({ length: 120 }, (_, index) => bill('a', '2026-03-01', 100 + index))
		);
		expect(await updateTask(db, contextA, created.id, input({ category: 'repair' }), ids)).toEqual({
			ok: true
		});
		expect((await getTask(db, 'a', created.id))?.costs.count).toBe(120);
	});

	it('gives the bills of the open next occurrence back to the task when it is reopened', async () => {
		const created = await createTask(
			db,
			contextA,
			input({ category: 'repair', dueDate: '2026-03-01', repeatMonths: 12 })
		);
		if (!created.ok) throw new Error(created.reason);
		await setDone(db, contextA, created.id, true, '2026-03-02');
		const followUpId = (await getTask(db, 'a', created.id))!.followUpId!;
		const paid = await bill('a', '2026-03-05', 4000, { taskId: followUpId });

		expect(await setDone(db, contextA, created.id, false)).toBe(true);
		expect(await getTask(db, 'a', followUpId)).toBeUndefined();
		const [row] = await db.select().from(expenses).where(eq(expenses.id, paid));
		expect(row.taskId).toBe(created.id);
	});
});
