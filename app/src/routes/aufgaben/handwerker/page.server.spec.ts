import { beforeEach, describe, expect, it } from 'vitest';
import { createContractor, listContractors } from '#lib/server/contractors.ts';
import type { Database } from '#lib/server/db/index.ts';
import { tasks } from '#lib/server/db/schema.ts';
import { contextB, outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, options)));
}

const fields = {
	name: 'Sanitär Wendt GmbH',
	trade: 'Sanitär',
	phone: '030 4471 2290',
	email: 'Info@Sanitaer-Wendt.de',
	note: ''
};

describe('aufgaben/handwerker', () => {
	it('adds, lists, changes and deletes a Handwerker', async () => {
		expect(await run(load)).toEqual({ data: { contractors: [], editing: null } });
		expect(await run(actions.create, { form: { ...fields, name: '' } })).toMatchObject({
			fail: 400,
			data: { errors: { name: expect.any(String) } }
		});
		expect(await run(actions.create, { form: { ...fields, email: 'kaputt' } })).toMatchObject({
			fail: 400,
			data: { errors: { email: expect.any(String) } }
		});
		expect(await run(actions.create, { form: fields })).toEqual({
			data: { created: 'Sanitär Wendt GmbH' }
		});
		const [contractor] = await listContractors(db, 'a');
		expect(contractor).toMatchObject({
			trade: 'Sanitär',
			email: 'info@sanitaer-wendt.de',
			note: null,
			taskCount: 0
		});
		await db.insert(tasks).values({ accountId: 'a', title: 'Leck', contractorId: contractor.id });
		expect(
			await run(load, { url: `/aufgaben/handwerker?bearbeiten=${contractor.id}` })
		).toMatchObject({ data: { editing: { id: contractor.id, taskCount: 1 } } });

		const id = contractor.id;
		expect(
			await run(actions.update, { form: { ...fields, id, name: 'Wendt Haustechnik' } })
		).toEqual({ redirect: '/aufgaben/handwerker' });
		expect(
			await run(actions.update, { form: { ...fields, id, phone: 'x'.repeat(41) } })
		).toMatchObject({ fail: 400, data: { edit: true } });
		expect(await run(actions.delete, { form: { id } })).toEqual({
			redirect: '/aufgaben/handwerker'
		});
		expect(await listContractors(db, 'a')).toEqual([]);
		const [task] = await db.select().from(tasks);
		expect(task.contractorId).toBeNull();
	});

	it('answers 404 for a Handwerker of another account', async () => {
		const id = await createContractor(db, contextB, {
			name: 'Fremd',
			trade: null,
			phone: null,
			email: null,
			note: null
		});
		expect(await run(actions.update, { form: { ...fields, id } })).toMatchObject({ error: 404 });
		expect(await run(actions.delete, { form: { id } })).toMatchObject({ error: 404 });
		expect(await listContractors(db, 'b')).toHaveLength(1);
	});
});
