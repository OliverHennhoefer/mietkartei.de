import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDamageReport, getDamageReport } from '#lib/server/damage-reports.ts';
import type { Database } from '#lib/server/db/index.ts';
import { getTask } from '#lib/server/tasks.ts';
import {
	memoryStorage,
	outcome,
	routeEvent,
	seedLease,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { actions, load as loadReport } from './[id]/+page.server';
import { load } from './+page.server';

const storage = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('#lib/server/storage/index.ts', async (original) => ({
	...(await original<typeof import('#lib/server/storage/index.ts')>()),
	getStorage: async () => storage.current
}));

let db: Database;
let leaseId: string;
let reportId: string;

beforeEach(async () => {
	db = await testDatabase();
	storage.current = memoryStorage();
	const { unitId } = await seedUnit(db, 'a');
	leaseId = await seedLease(db, 'a', unitId);
	const created = await createDamageReport(
		db,
		{ accountId: 'a', leaseId },
		{
			title: 'Fenster klemmt',
			description: 'Schlafzimmer',
			location: null,
			urgent: false,
			reporterName: null,
			reporterPhone: null
		}
	);
	if (!created.ok) throw new Error(created.reason);
	reportId = created.id;
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, { params: { id: reportId }, ...options })));
}

describe('schadensmeldungen', () => {
	it('lists the reports of the account', async () => {
		expect(await run(load)).toMatchObject({
			data: { open: [{ id: reportId, lease: { id: leaseId } }], done: [] }
		});
	});

	it('shows a report and answers 404 for another account’s', async () => {
		expect(await run(loadReport)).toMatchObject({
			data: { report: { id: reportId, title: 'Fenster klemmt' }, photos: [] }
		});
		const otherUser = { id: 'user-b', email: 'b@example.org', accountId: 'b', name: null };
		const other = { user: { ...otherUser, role: 'owner' as const } };
		expect(await run(loadReport, other)).toMatchObject({ error: 404 });
		for (const action of [actions.update, actions.task, actions.delete]) {
			expect(await run(action, { ...other, form: { status: 'done' } })).toMatchObject({
				error: 404
			});
		}
	});

	it('sets status and reply', async () => {
		expect(await run(actions.update, { form: { status: 'done', reply: 'Repariert.' } })).toEqual({
			data: { saved: true }
		});
		expect(await getDamageReport(db, 'a', reportId)).toMatchObject({
			status: 'done',
			reply: 'Repariert.'
		});
		expect(await run(actions.update, { form: { status: 'kaputt' } })).toMatchObject({
			fail: 400
		});
	});

	it('makes a task of the report and leads to it', async () => {
		const result = await run(actions.task);
		expect(result).toMatchObject({ redirect: expect.stringMatching(/^\/aufgaben\//) });
		const taskId = (result as { redirect: string }).redirect.split('/').at(-1)!;
		expect(await getTask(db, 'a', taskId)).toMatchObject({ leaseId });
	});

	it('deletes the report', async () => {
		expect(await run(actions.delete)).toEqual({ redirect: '/schadensmeldungen' });
		expect(await getDamageReport(db, 'a', reportId)).toBeUndefined();
	});
});
