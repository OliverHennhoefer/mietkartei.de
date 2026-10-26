import { fail, redirect } from '@sveltejs/kit';
import { locateInBackground } from '#lib/server/geocoding.ts';
import { showsPropertyMaps } from '#lib/server/preferences.ts';
import { addProperty } from '#lib/server/properties.ts';
import { auditContext, requireAccount, requireUser } from '#lib/server/session.ts';
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
		const context = auditContext(locals);
		const property = await addProperty(locals.db, context, result.data);
		// Its map position follows in the background; saving never waits for the geocoder.
		if (await showsPropertyMaps(locals.db, requireUser(locals).id)) {
			await locateInBackground(locals.db, context.accountId);
		}
		redirect(303, `/objekte/${property.id}`);
	}
};
