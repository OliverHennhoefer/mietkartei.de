import { error, fail, redirect } from '@sveltejs/kit';
import { parseInsurancePolicy } from '#lib/forms/insurance.ts';
import { deletePolicy, getPolicy, updatePolicy } from '#lib/server/insurance.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

const missing = 'Diese Versicherung gibt es nicht.';

/** The policy, only when it belongs to the property of the URL. */
async function policyOf(locals: App.Locals, propertyId: string, policyId: string) {
	const policy = await getPolicy(locals.db, requireAccount(locals), policyId);
	if (!policy || policy.propertyId !== propertyId) error(404, missing);
	return policy;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	return { policy: await policyOf(locals, params.id, params.policyId) };
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		await policyOf(locals, params.id, params.policyId);
		const result = parseInsurancePolicy(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		if (!(await updatePolicy(locals.db, auditContext(locals), params.policyId, result.data))) {
			error(404, missing);
		}
		redirect(303, `/objekte/${params.id}/versicherungen`);
	},
	delete: async ({ locals, params }) => {
		await policyOf(locals, params.id, params.policyId);
		await deletePolicy(locals.db, auditContext(locals), params.policyId);
		redirect(303, `/objekte/${params.id}/versicherungen`);
	}
};
