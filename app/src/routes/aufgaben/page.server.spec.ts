import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { getTask, listTasks } from '#lib/server/tasks.ts';
import { outcome, routeEvent, seedLease, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { actions as taskActions, load as loadTask } from './[id]/+page.server';
import { actions, load } from './+page.server';

let db: Database;
let propertyId: string;
let leaseId: string;

beforeEach(async () => {
	db = await testDatabase();
	const seeded = await seedUnit(db, 'a');
	propertyId = seeded.propertyId;
	leaseId = await seedLease(db, 'a', seeded.unitId);
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, options)));
}

async function createTask(form: Record<string, string>) {
	await run(actions.create, { form });
	return (await listTasks(db, 'a')).open.at(-1)!.id;
}

describe('aufgaben', () => {
	it('creates tasks linked to a property or lease of the account only', async () => {
		expect(
			await run(actions.create, { form: { title: 'Rauchmelder', link: `property:${propertyId}` } })
		).toEqual({ data: { created: 'Rauchmelder' } });
		const other = await seedUnit(db, 'b');
		expect(
			await run(actions.create, { form: { title: 'Fremd', link: `property:${other.propertyId}` } })
		).toMatchObject({ fail: 400, data: { errors: { link: 'Dieses Objekt gibt es nicht.' } } });
		expect(
			await run(actions.create, { form: { title: 'Fremd', link: 'lease:unbekannt' } })
		).toMatchObject({ fail: 400, data: { errors: { link: 'Diesen Mietvertrag gibt es nicht.' } } });
		expect(await run(actions.create, { form: { title: '' } })).toMatchObject({ fail: 400 });
	});

	it('lists deadlines, open and done tasks with the link options', async () => {
		const id = await createTask({ title: 'Zähler ablesen', dueDate: '2026-12-31' });
		expect(await run(actions.done, { form: { id, done: 'true' } })).toEqual({
			data: { toggled: id }
		});
		expect(await run(load)).toMatchObject({
			data: {
				open: [],
				done: [{ id }],
				properties: [{ id: propertyId }],
				leases: [{ id: leaseId, active: true }]
			}
		});
		expect(await run(actions.done, { form: { id: 'x', done: 'true' } })).toMatchObject({
			fail: 404
		});
	});

	it('deletes a task from the list once', async () => {
		const id = await createTask({ title: 'Weg' });
		expect(await run(actions.delete, { form: { id } })).toEqual({ data: { deleted: id } });
		expect(await run(actions.delete, { form: { id } })).toMatchObject({ fail: 404 });
	});
});

describe('aufgaben/[id]', () => {
	it('edits and deletes a task, and answers 404 for another account’s', async () => {
		const id = await createTask({ title: 'Heizung warten' });
		expect(await run(loadTask, { params: { id } })).toMatchObject({
			data: { task: { id, title: 'Heizung warten' } }
		});
		expect(
			await run(taskActions.update, {
				params: { id },
				form: { title: 'Heizung warten lassen', link: `lease:${leaseId}` }
			})
		).toEqual({ redirect: '/aufgaben' });
		expect((await getTask(db, 'a', id))?.leaseId).toBe(leaseId);
		expect(
			await run(taskActions.update, { params: { id }, form: { title: 'x', link: 'lease:fremd' } })
		).toMatchObject({ fail: 400, data: { errors: { link: expect.any(String) } } });
		expect(await run(taskActions.update, { params: { id }, form: { title: '' } })).toMatchObject({
			fail: 400
		});
		expect(await run(taskActions.delete, { params: { id }, form: {} })).toEqual({
			redirect: '/aufgaben'
		});
		for (const handler of [loadTask, taskActions.update, taskActions.delete]) {
			expect(await run(handler, { params: { id }, form: { title: 'x' } })).toMatchObject({
				error: 404
			});
		}
	});
});
