import { fail, redirect } from '@sveltejs/kit';
import { requireAccount } from '#lib/server/session.ts';
import { createProperty, listProperties } from '#lib/server/properties.ts';
import { parseProperty } from '#lib/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return { properties: await listProperties(locals.db, requireAccount(locals)) };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const result = parseProperty(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const property = await createProperty(locals.db, requireAccount(locals), result.data);
		redirect(303, `/objekte/${property.id}`);
	}
};
