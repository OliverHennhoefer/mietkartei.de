import { error, fail, redirect } from '@sveltejs/kit';
import { parseServiceProvider } from '#lib/forms/service-providers.ts';
import {
	createServiceProvider,
	deleteServiceProvider,
	listServiceProviders,
	updateServiceProvider
} from '#lib/server/service-providers.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Dienstleister: the list with the tasks and expenses of each, and the form to add one.
// ?bearbeiten=<id> opens one in the edit dialog.
export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const serviceProviders = await listServiceProviders(locals.db, accountId);
	const editing =
		serviceProviders.find((row) => row.id === url.searchParams.get('bearbeiten')) ?? null;
	return { serviceProviders, editing };
};

const missing = 'Diesen Dienstleister gibt es nicht.';

const idOf = (form: FormData) => String(form.get('id') ?? '');

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const result = parseServiceProvider(form);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		await createServiceProvider(locals.db, auditContext(locals), result.data);
		return { created: result.data.name };
	},
	update: async ({ request, locals }) => {
		const form = await request.formData();
		const result = parseServiceProvider(form);
		if (!result.ok) return fail(400, { edit: true, errors: result.errors, values: result.values });
		if (!(await updateServiceProvider(locals.db, auditContext(locals), idOf(form), result.data))) {
			error(404, missing);
		}
		redirect(303, '/dienstleister');
	},
	delete: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (!(await deleteServiceProvider(locals.db, auditContext(locals), id))) error(404, missing);
		redirect(303, '/dienstleister');
	}
};
