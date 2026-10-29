import { error, fail, redirect } from '@sveltejs/kit';
import { parseContractor } from '#lib/forms/contractors.ts';
import {
	createContractor,
	deleteContractor,
	listContractors,
	updateContractor
} from '#lib/server/contractors.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Handwerker: the list with the number of tasks of each, and the form to add one.
// ?bearbeiten=<id> opens one in the edit dialog.
export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const contractors = await listContractors(locals.db, accountId);
	const editing = contractors.find((row) => row.id === url.searchParams.get('bearbeiten')) ?? null;
	return { contractors, editing };
};

const missing = 'Diesen Handwerker gibt es nicht.';

const idOf = (form: FormData) => String(form.get('id') ?? '');

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const result = parseContractor(form);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		await createContractor(locals.db, auditContext(locals), result.data);
		return { created: result.data.name };
	},
	update: async ({ request, locals }) => {
		const form = await request.formData();
		const result = parseContractor(form);
		if (!result.ok) return fail(400, { edit: true, errors: result.errors, values: result.values });
		if (!(await updateContractor(locals.db, auditContext(locals), idOf(form), result.data))) {
			error(404, missing);
		}
		redirect(303, '/aufgaben/handwerker');
	},
	delete: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (!(await deleteContractor(locals.db, auditContext(locals), id))) error(404, missing);
		redirect(303, '/aufgaben/handwerker');
	}
};
