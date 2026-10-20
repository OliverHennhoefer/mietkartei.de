import { fail, redirect } from '@sveltejs/kit';
import { parseTenant } from '#lib/forms/tenants.ts';
import { personName } from '#lib/format.ts';
import { logChange } from '#lib/server/audit.ts';
import { auditContext } from '#lib/server/session.ts';
import { createTenant } from '#lib/server/tenants.ts';
import type { Actions, PageServerLoad } from './$types';

/** Only a path of this app, so the page never redirects to another site. */
function returnPath(value: string | null | undefined): string | null {
	return value && /^\/(?!\/)/.test(value) ? value : null;
}

// ?return=<path> brings the user back to where they came from (the lease form), with the new
// tenant preselected through ?tenantId=.
export const load: PageServerLoad = async ({ url }) => {
	return { returnTo: returnPath(url.searchParams.get('return')) };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const context = auditContext(locals);
		const form = await request.formData();
		const result = parseTenant(form);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const tenant = await createTenant(locals.db, context.accountId, result.data);
		await logChange(
			locals.db,
			context,
			'tenant',
			tenant.id,
			'create',
			`Mieter ${personName(tenant)} angelegt`
		);
		const back = returnPath(form.get('return')?.toString());
		if (back) {
			redirect(303, `${back}${back.includes('?') ? '&' : '?'}tenantId=${tenant.id}`);
		}
		redirect(303, `/mieter/${tenant.id}`);
	}
};
