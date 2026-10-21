import { error, fail, redirect } from '@sveltejs/kit';
import { getUnit, updateUnit } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { parseUnit } from '#lib/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const unit = await getUnit(locals.db, accountId, params.unitId);
	if (!unit || unit.propertyId !== params.id) error(404, 'Diese Einheit gibt es nicht.');
	return { unit };
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const accountId = requireAccount(locals);
		const unit = await getUnit(locals.db, accountId, params.unitId);
		if (!unit || unit.propertyId !== params.id) error(404, 'Diese Einheit gibt es nicht.');
		const result = parseUnit(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const updated = await updateUnit(locals.db, auditContext(locals), unit.id, result.data);
		if (!updated) error(404, 'Diese Einheit gibt es nicht.');
		redirect(303, `/objekte/${params.id}/einheiten/${unit.id}`);
	}
};
