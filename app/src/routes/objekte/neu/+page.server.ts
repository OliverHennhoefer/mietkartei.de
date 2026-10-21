import { fail, redirect } from '@sveltejs/kit';
import { addProperty } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { parseProperty } from '#lib/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireAccount(locals);
	return {};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const result = parseProperty(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const property = await addProperty(locals.db, auditContext(locals), result.data);
		redirect(303, `/objekte/${property.id}`);
	}
};
