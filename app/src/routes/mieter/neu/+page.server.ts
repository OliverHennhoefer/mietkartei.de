import { fail, redirect } from '@sveltejs/kit';
import { parseTenant } from '#lib/forms/tenants.ts';
import { returnPath } from '#lib/return-path.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { createTenant, getTenant } from '#lib/server/tenants.ts';
import type { Actions, PageServerLoad } from './$types';

// ?return=<path> brings the user back to where they came from (the lease form), with the new
// tenant preselected through ?tenantId=. Without it the lease form comes next as well: every tenant
// needs a lease, which assigns the unit and with it the address for letters. "Speichern und
// nächsten Mieter" comes back here instead, with ?angelegt=<id>, which names the tenant just saved.
export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const createdId = url.searchParams.get('angelegt');
	const created = createdId ? await getTenant(locals.db, accountId, createdId) : undefined;
	return {
		returnTo: returnPath(url.searchParams.get('return')),
		created: created
			? { id: created.id, firstName: created.firstName, lastName: created.lastName }
			: null
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const context = auditContext(locals);
		const form = await request.formData();
		const result = parseTenant(form);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const tenant = await createTenant(locals.db, context, result.data);
		const back = returnPath(form.get('return')?.toString());
		if (back) {
			redirect(303, `${back}${back.includes('?') ? '&' : '?'}tenantId=${tenant.id}`);
		}
		if (form.get('next') === '1') redirect(303, `/mieter/neu?angelegt=${tenant.id}`);
		redirect(303, `/vertraege/neu?tenantId=${tenant.id}&created=1`);
	}
};
