import { error, fail } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { addUnit, unitsWithOccupancy } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { parseUnit } from '#lib/validation.ts';
import type { Actions, PageServerLoad } from './$types';

// The property itself comes from +layout.server.ts (data.property), which answers 404.
export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	return { units: await unitsWithOccupancy(locals.db, accountId, params.id, today()) };
};

export const actions: Actions = {
	createUnit: async ({ request, locals, params }) => {
		const result = parseUnit(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const unit = await addUnit(locals.db, auditContext(locals), params.id, result.data);
		if (!unit) error(404, 'Dieses Objekt gibt es nicht.');
		return { created: result.data.name };
	}
};
