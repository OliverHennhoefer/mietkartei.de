import { error, fail, redirect } from '@sveltejs/kit';
import { parseTenant } from '#lib/forms/tenants.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { getTenant, updateTenant } from '#lib/server/tenants.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const tenant = await getTenant(locals.db, requireAccount(locals), params.id);
	if (!tenant) error(404, 'Diesen Mieter gibt es nicht.');
	return { tenant };
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const result = parseTenant(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const updated = await updateTenant(locals.db, context, params.id, result.data);
		if (!updated) error(404, 'Diesen Mieter gibt es nicht.');
		redirect(303, `/mieter/${params.id}`);
	}
};
