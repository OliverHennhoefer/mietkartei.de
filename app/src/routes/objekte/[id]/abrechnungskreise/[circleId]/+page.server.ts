import { error, fail, redirect } from '@sveltejs/kit';
import { formValues, parseCircle } from '#lib/forms/operating-costs.ts';
import { deleteCircle, getCircle, updateCircle } from '#lib/server/operating-costs.ts';
import { listUnits } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

const missing = 'Diesen Abrechnungskreis gibt es nicht.';

/** The circle, only when it belongs to the property of the URL. */
async function circleOf(locals: App.Locals, propertyId: string, circleId: string) {
	const circle = await getCircle(locals.db, requireAccount(locals), circleId);
	if (!circle || circle.propertyId !== propertyId) error(404, missing);
	return circle;
}

export const load: PageServerLoad = async ({ locals, params, parent }) => {
	const { property } = await parent();
	const circle = await circleOf(locals, property.id, params.circleId);
	return { circle, units: await listUnits(locals.db, requireAccount(locals), property.id) };
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		await circleOf(locals, params.id, params.circleId);
		const form = await request.formData();
		const result = parseCircle(form);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const updated = await updateCircle(
			locals.db,
			auditContext(locals),
			params.circleId,
			result.data
		);
		if (!updated.ok) {
			if (updated.reason === 'missing') error(404, missing);
			return fail(400, {
				errors: { unitIds: 'Eine der Einheiten gehört nicht zu diesem Objekt.' },
				values: formValues(form)
			});
		}
		redirect(303, `/objekte/${params.id}/abrechnungskreise`);
	},
	delete: async ({ locals, params }) => {
		await circleOf(locals, params.id, params.circleId);
		await deleteCircle(locals.db, auditContext(locals), params.circleId);
		redirect(303, `/objekte/${params.id}/abrechnungskreise`);
	}
};
