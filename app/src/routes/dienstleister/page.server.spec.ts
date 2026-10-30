import { beforeEach, describe, expect, it } from 'vitest';
import { createServiceProvider, listServiceProviders } from '#lib/server/service-providers.ts';
import type { Database } from '#lib/server/db/index.ts';
import { expenses, tasks } from '#lib/server/db/schema.ts';
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
	service: 'Sanitär',
	phone: '030 4471 2290',
	email: 'Info@Sanitaer-Wendt.de',
	note: ''
};

describe('dienstleister', () => {
	it('adds, lists, changes and deletes a Dienstleister', async () => {
		expect(await run(load)).toEqual({ data: { serviceProviders: [], editing: null } });
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
		const [serviceProvider] = await listServiceProviders(db, 'a');
		expect(serviceProvider).toMatchObject({
			service: 'Sanitär',
			email: 'info@sanitaer-wendt.de',
			note: null,
			taskCount: 0,
			expenses: { count: 0, total: 0, lastDate: null }
		});
		await db
			.insert(tasks)
			.values({ accountId: 'a', title: 'Leck', serviceProviderId: serviceProvider.id });
		const bill = (date: string, amount: number, serviceProviderId: string | null) =>
			db.insert(expenses).values({
				accountId: 'a',
				date,
				amount,
				category: 'maintenance',
				description: 'Rechnung',
				serviceProviderId
			});
		await bill('2026-02-01', 12000, serviceProvider.id);
		await bill('2026-05-01', 3000, serviceProvider.id);
		await bill('2026-06-01', 9900, null);
		expect(
			await run(load, { url: `/dienstleister?bearbeiten=${serviceProvider.id}` })
		).toMatchObject({
			data: {
				editing: {
					id: serviceProvider.id,
					taskCount: 1,
					expenses: { count: 2, total: 15000, lastDate: '2026-05-01' }
				}
			}
		});

		const id = serviceProvider.id;
		expect(
			await run(actions.update, { form: { ...fields, id, name: 'Wendt Haustechnik' } })
		).toEqual({ redirect: '/dienstleister' });
		expect(
			await run(actions.update, { form: { ...fields, id, phone: 'x'.repeat(41) } })
		).toMatchObject({ fail: 400, data: { edit: true } });
		expect(await run(actions.delete, { form: { id } })).toEqual({
			redirect: '/dienstleister'
		});
		expect(await listServiceProviders(db, 'a')).toEqual([]);
		const [task] = await db.select().from(tasks);
		expect(task.serviceProviderId).toBeNull();
		expect((await db.select().from(expenses)).map((row) => row.serviceProviderId)).toEqual([
			null,
			null,
			null
		]);
	});

	it('answers 404 for a Dienstleister of another account', async () => {
		const id = await createServiceProvider(db, contextB, {
			name: 'Fremd',
			service: null,
			phone: null,
			email: null,
			note: null
		});
		expect(await run(actions.update, { form: { ...fields, id } })).toMatchObject({ error: 404 });
		expect(await run(actions.delete, { form: { id } })).toMatchObject({ error: 404 });
		expect(await listServiceProviders(db, 'b')).toHaveLength(1);
	});
});
