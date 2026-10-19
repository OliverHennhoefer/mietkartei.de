import { error, fail } from '@sveltejs/kit';
import { createUnit, getProperty, listUnits } from '#lib/server/properties.ts';
import { parseUnit } from '#lib/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const property = await getProperty(locals.db, locals.accountId, params.id);
	if (!property) error(404, 'Dieses Objekt gibt es nicht.');
	return { property, units: await listUnits(locals.db, locals.accountId, property.id) };
};

export const actions: Actions = {
	createUnit: async ({ request, locals, params }) => {
		const result = parseUnit(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const unit = await createUnit(locals.db, locals.accountId, params.id, result.data);
		if (!unit) error(404, 'Dieses Objekt gibt es nicht.');
		return { created: unit.name };
	}
};
