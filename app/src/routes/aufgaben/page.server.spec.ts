import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { today } from '#lib/dates.ts';
import { createContractor } from '#lib/server/contractors.ts';
import { expenses } from '#lib/server/db/schema.ts';
import { createTask as storeTask, getTask, listTasks } from '#lib/server/tasks.ts';
import {
	contextA,
	contextB,
	outcome,
	routeEvent,
	seedLease,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
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

	it('fills the create form from a template and ignores unknown ones', async () => {
		expect(await run(load, { url: '/aufgaben?vorlage=rauchwarnmelder' })).toMatchObject({
			data: {
				template: {
					key: 'rauchwarnmelder',
					title: 'Rauchwarnmelder prüfen',
					category: 'inspection',
					repeatMonths: '12'
				}
			}
		});
		expect(await run(load, { url: '/aufgaben?vorlage=unbekannt' })).toMatchObject({
			data: { template: null }
		});
	});

	it('creates a repeating task whose done copy comes back', async () => {
		const id = await createTask({
			title: 'Heizung warten',
			category: 'maintenance',
			dueDate: '2026-09-15',
			repeatMonths: '12'
		});
		await run(actions.done, { form: { id, done: 'true' } });
		const { open } = await listTasks(db, 'a');
		expect(open).toMatchObject([
			{ title: 'Heizung warten', category: 'maintenance', repeatMonths: 12 }
		]);
		expect(open[0].dueDate! > '2026-09-15').toBe(true);
	});

	it('deletes a task from the list once', async () => {
		const id = await createTask({ title: 'Weg' });
		expect(await run(actions.delete, { form: { id } })).toEqual({ redirect: '/aufgaben' });
		expect(await run(actions.delete, { form: { id } })).toMatchObject({ fail: 404 });
	});

	it('opens a task in the edit dialog and saves it', async () => {
		const id = await createTask({ title: 'Heizung warten' });
		expect(await run(load, { url: `/aufgaben?bearbeiten=${id}` })).toMatchObject({
			data: { editing: { id, title: 'Heizung warten' } }
		});
		expect(await run(load, { url: '/aufgaben?bearbeiten=unbekannt' })).toMatchObject({
			data: { editing: null }
		});
		expect(
			await run(actions.update, {
				form: { id, title: 'Heizung warten lassen', link: `lease:${leaseId}` }
			})
		).toEqual({ redirect: '/aufgaben' });
		expect((await getTask(db, 'a', id))?.leaseId).toBe(leaseId);
		expect(
			await run(actions.update, { form: { id, title: 'x', link: 'lease:fremd' } })
		).toMatchObject({ fail: 400, data: { edit: true, errors: { link: expect.any(String) } } });
		expect(await run(actions.update, { form: { id, title: '' } })).toMatchObject({
			fail: 400,
			data: { edit: true }
		});
	});

	it("neither opens, edits nor deletes another account's task", async () => {
		const foreign = await storeTask(db, contextB, {
			title: 'Fremd',
			category: 'other',
			dueDate: null,
			repeatMonths: null,
			propertyId: null,
			leaseId: null,
			note: null
		});
		if (!foreign.ok) throw new Error('setup failed');
		const id = foreign.id;
		expect(await run(load, { url: `/aufgaben?bearbeiten=${id}` })).toMatchObject({
			data: { editing: null }
		});
		for (const handler of [actions.update, actions.delete]) {
			expect(await run(handler, { form: { id, title: 'x' } })).toMatchObject({ fail: 404 });
		}
		expect(await getTask(db, 'b', id)).toMatchObject({ title: 'Fremd' });
	});

	it('names a Handwerker and links the expenses that paid for a Reparatur', async () => {
		const contractorId = await createContractor(db, contextA, {
			name: 'Elektro Lindner',
			trade: 'Elektro',
			phone: null,
			email: null,
			note: null
		});
		expect(
			await run(actions.create, { form: { title: 'Fremd', contractorId: 'unbekannt' } })
		).toMatchObject({
			fail: 400,
			data: { errors: { contractorId: 'Diesen Handwerker gibt es nicht.' } }
		});
		const form = {
			title: 'Hofbeleuchtung defekt',
			category: 'repair',
			link: `property:${propertyId}`,
			contractorId
		};
		const id = await createTask(form);
		const [expense] = await db
			.insert(expenses)
			.values({
				accountId: 'a',
				propertyId,
				date: today(),
				amount: 18900,
				category: 'maintenance',
				description: 'Bewegungsmelder getauscht'
			})
			.returning({ id: expenses.id });

		expect(await run(load, { url: `/aufgaben?bearbeiten=${id}` })).toMatchObject({
			data: {
				contractors: [{ id: contractorId, name: 'Elektro Lindner (Elektro)' }],
				editing: { id, contractor: { name: 'Elektro Lindner' } },
				editingExpenses: { linked: [], candidates: [{ id: expense.id }] }
			}
		});
		expect(
			await run(actions.update, {
				form: { ...form, id, expenses: '1', expenseId: 'unbekannt' }
			})
		).toMatchObject({ fail: 400, data: { edit: true, message: expect.any(String) } });
		expect(
			await run(actions.update, { form: { ...form, id, expenses: '1', expenseId: expense.id } })
		).toEqual({ redirect: '/aufgaben' });
		expect((await getTask(db, 'a', id))?.costs).toEqual({ total: 18900, count: 1 });
		expect(await run(load)).toMatchObject({
			data: { open: [{ id, costs: { total: 18900 } }], editingExpenses: null }
		});
	});
});
