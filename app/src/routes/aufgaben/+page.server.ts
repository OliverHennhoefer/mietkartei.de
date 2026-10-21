import { fail } from '@sveltejs/kit';
import { addMonths, today } from '#lib/dates.ts';
import { parseTask } from '#lib/forms/tasks.ts';
import { listDeadlines } from '#lib/server/deadlines.ts';
import { leaseLabel, listLeases } from '#lib/server/leases.ts';
import { listProperties } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { createTask, deleteTask, listTasks, setDone } from '#lib/server/tasks.ts';
import type { Actions, PageServerLoad } from './$types';

const linkErrors = {
	'unknown-property': 'Dieses Objekt gibt es nicht.',
	'unknown-lease': 'Diesen Mietvertrag gibt es nicht.',
	missing: 'Diese Aufgabe gibt es nicht.'
};

export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	const date = today();
	const [deadlines, tasks, properties, leases] = await Promise.all([
		listDeadlines(locals.db, accountId, { to: addMonths(date, 12) }),
		listTasks(locals.db, accountId),
		listProperties(locals.db, accountId),
		listLeases(locals.db, accountId)
	]);
	return {
		today: date,
		deadlines,
		open: tasks.open,
		done: tasks.done,
		properties: properties.map((property) => ({ id: property.id, name: property.name })),
		leases: leases.map((lease) => ({
			id: lease.id,
			label: leaseLabel(lease),
			active: lease.active
		}))
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const result = parseTask(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const created = await createTask(locals.db, auditContext(locals), result.data);
		if (!created.ok) {
			return fail(400, { errors: { link: linkErrors[created.reason] }, values: result.values });
		}
		return { created: result.data.title };
	},
	done: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const done = form.get('done') === 'true';
		if (!(await setDone(locals.db, auditContext(locals), id, done))) {
			return fail(404, { message: 'Diese Aufgabe gibt es nicht.' });
		}
		return { toggled: id };
	},
	delete: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!(await deleteTask(locals.db, auditContext(locals), id))) {
			return fail(404, { message: 'Diese Aufgabe gibt es nicht.' });
		}
		return { deleted: id };
	}
};
