import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { notificationStates, tasks } from '#lib/server/db/schema.ts';
import { outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

let db: Database;
let key: string;

beforeEach(async () => {
	db = await testDatabase();
	const [task] = await db
		.insert(tasks)
		.values({ accountId: 'a', title: 'Rauchmelder prüfen', dueDate: '2099-01-10' })
		.returning({ id: tasks.id });
	key = `task-${task.id}`;
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() =>
		handler(
			routeEvent(db, { url: `https://app.example/erinnerung/${key}`, params: { key }, ...options })
		)
	);
}

describe('erinnerung/[key]', () => {
	it('shows the entry, snoozes it and marks the task done', async () => {
		expect(await run(load)).toMatchObject({
			data: {
				entry: {
					title: 'Rauchmelder prüfen',
					href: expect.stringMatching(/^\/aufgaben\?bearbeiten=/)
				},
				canComplete: true,
				snoozedUntil: undefined
			}
		});
		expect(await run(actions.snooze, { form: { days: '5' } })).toMatchObject({ fail: 400 });
		expect(await run(actions.snooze, { form: { days: '7' } })).toMatchObject({
			data: { snoozed: expect.any(String) }
		});
		expect(await db.select().from(notificationStates)).toHaveLength(1);
		expect(await run(load)).toMatchObject({ data: { snoozedUntil: expect.any(String) } });
		expect(await run(actions.done)).toEqual({ data: { done: true } });
		const [task] = await db.select().from(tasks);
		expect(task.done).toBe(true);
		// Done, it is no longer an entry.
		expect(await run(load)).toMatchObject({ error: 404 });
	});

	it('knows only the entries of the own account', async () => {
		expect(
			await run(load, {
				user: { id: 'user-b', email: 'b@example.org', accountId: 'b', name: null, role: 'owner' }
			})
		).toMatchObject({ error: 404 });
		expect(
			await outcome(() => load(routeEvent(db, { params: { key: 'nonsense' } }) as never))
		).toMatchObject({ error: 404 });
	});
});
