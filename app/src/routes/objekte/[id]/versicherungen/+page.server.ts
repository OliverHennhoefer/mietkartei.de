import { error, fail, redirect } from '@sveltejs/kit';
import { parseInsurancePolicy } from '#lib/forms/insurance.ts';
import { createPolicy, listPolicies } from '#lib/server/insurance.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const accountId = requireAccount(locals);
	const { property } = await parent();
	return { policies: await listPolicies(locals.db, accountId, property.id) };
};

export const actions: Actions = {
	create: async ({ request, locals, params }) => {
		const result = parseInsurancePolicy(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const created = await createPolicy(locals.db, auditContext(locals), params.id, result.data);
		if (!created.ok) error(404, 'Dieses Objekt gibt es nicht.');
		redirect(303, `/objekte/${params.id}/versicherungen`);
	}
};
