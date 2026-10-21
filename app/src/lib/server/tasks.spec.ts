import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { auditLog, tasks } from './db/schema';
import { createLease } from './leases';
import { QUOTAS } from './quotas';
import {
	countOpenTasks,
	createTask,
	deleteTask,
	getTask,
	listTasks,
	setDone,
	updateTask
} from './tasks';
import { contextA, contextB, leaseInput, seedUnit, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

const input = (overrides: Partial<Parameters<typeof createTask>[2]> = {}) => ({
	title: 'Rauchmelder prüfen',
	dueDate: null,
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

describe('countOpenTasks', () => {
	it("counts the open tasks of the account, not done ones or another account's", async () => {
		expect(await countOpenTasks(db, 'a')).toBe(0);
		await createTask(db, contextA, input({ title: 'Offen 1' }));
		await createTask(db, contextA, input({ title: 'Offen 2', dueDate: '2026-11-30' }));
		const done = await createTask(db, contextA, input({ title: 'Erledigt' }));
		if (!done.ok) throw new Error('task');
		await setDone(db, contextA, done.id, true);
		await createTask(db, contextB, input({ title: 'Fremde' }));

		expect(await countOpenTasks(db, 'a')).toBe(2);
		expect(await countOpenTasks(db, 'b')).toBe(1);
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
