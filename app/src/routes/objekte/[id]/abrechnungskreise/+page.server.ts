import { error, fail, redirect } from '@sveltejs/kit';
import { formValues, parseCircle } from '#lib/forms/operating-costs.ts';
import { createCircle, ensureDefaults, listCircles } from '#lib/server/operating-costs.ts';
import { listUnits } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const accountId = requireAccount(locals);
	const { property } = await parent();
	await ensureDefaults(locals.db, accountId);
	const [circles, units] = await Promise.all([
		listCircles(locals.db, accountId, property.id),
		listUnits(locals.db, accountId, property.id)
	]);
	return { circles, units };
};

export const actions: Actions = {
	create: async ({ request, locals, params }) => {
		const form = await request.formData();
		const result = parseCircle(form);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const created = await createCircle(locals.db, auditContext(locals), params.id, result.data);
		if (!created.ok) {
			if (created.reason === 'unknown-property') error(404, 'Dieses Objekt gibt es nicht.');
			return fail(400, {
				errors: { unitIds: 'Eine der Einheiten gehört nicht zu diesem Objekt.' },
				values: formValues(form)
			});
		}
		redirect(303, `/objekte/${params.id}/abrechnungskreise`);
	}
};
