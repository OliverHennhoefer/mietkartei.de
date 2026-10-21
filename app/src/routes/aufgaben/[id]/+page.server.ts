import { error, fail, redirect } from '@sveltejs/kit';
import { parseTask } from '#lib/forms/tasks.ts';
import { leaseLabel, listLeases } from '#lib/server/leases.ts';
import { listProperties } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { deleteTask, getTask, updateTask } from '#lib/server/tasks.ts';
import type { Actions, PageServerLoad } from './$types';

const linkErrors = {
	'unknown-property': 'Dieses Objekt gibt es nicht.',
	'unknown-lease': 'Diesen Mietvertrag gibt es nicht.',
	missing: 'Diese Aufgabe gibt es nicht.'
};

export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const task = await getTask(locals.db, accountId, params.id);
	if (!task) error(404, 'Diese Aufgabe gibt es nicht.');
	const [properties, leases] = await Promise.all([
		listProperties(locals.db, accountId),
		listLeases(locals.db, accountId)
	]);
	return {
		task,
		properties: properties.map((property) => ({ id: property.id, name: property.name })),
		leases: leases.map((lease) => ({
			id: lease.id,
			label: leaseLabel(lease),
			active: lease.active
		}))
	};
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		// A task of another account answers 404 before its form is read.
		if (!(await getTask(locals.db, requireAccount(locals), params.id))) {
			error(404, linkErrors.missing);
		}
		const result = parseTask(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const updated = await updateTask(locals.db, auditContext(locals), params.id, result.data);
		if (!updated.ok) {
			if (updated.reason === 'missing') error(404, linkErrors.missing);
			return fail(400, { errors: { link: linkErrors[updated.reason] }, values: result.values });
		}
		redirect(303, '/aufgaben');
	},
	delete: async ({ locals, params }) => {
		if (!(await deleteTask(locals.db, auditContext(locals), params.id))) {
			error(404, linkErrors.missing);
		}
		redirect(303, '/aufgaben');
	}
};
