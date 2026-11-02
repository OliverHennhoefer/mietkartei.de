import { error, fail, redirect } from '@sveltejs/kit';
import { parseTenant } from '#lib/forms/tenants.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { listLeases } from '#lib/server/leases.ts';
import { getTenant, postalAddress, updateTenant } from '#lib/server/tenants.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const [tenant, leases] = await Promise.all([
		getTenant(locals.db, accountId, params.id),
		listLeases(locals.db, accountId, { tenantId: params.id })
	]);
	if (!tenant) error(404, 'Diesen Mieter gibt es nicht.');
	// The unit's address for the form's hint, as if the tenant had no address of their own.
	const leaseAddress = postalAddress(
		{ id: tenant.id, street: null, postalCode: null, city: null },
		leases
	);
	return { tenant, leaseAddress: leaseAddress?.line ?? null };
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const result = parseTenant(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const updated = await updateTenant(locals.db, context, params.id, result.data);
		if (!updated) error(404, 'Diesen Mieter gibt es nicht.');
		redirect(303, `/mieter/${params.id}`);
	}
};
