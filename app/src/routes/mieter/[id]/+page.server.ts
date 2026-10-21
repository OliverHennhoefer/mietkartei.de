import { error, fail, redirect } from '@sveltejs/kit';
import { personName } from '#lib/format.ts';
import { logChange } from '#lib/server/audit.ts';
import { listLeases } from '#lib/server/leases.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { deleteTenant, getTenant } from '#lib/server/tenants.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const tenant = await getTenant(locals.db, accountId, params.id);
	if (!tenant) error(404, 'Diesen Mieter gibt es nicht.');
	const leases = await listLeases(locals.db, accountId, { tenantId: tenant.id });
	return {
		tenant,
		leases: leases.map((lease) => ({
			id: lease.id,
			label: `${lease.unit.name} · ${lease.property.name}`,
			startDate: lease.startDate,
			endDate: lease.endDate,
			active: lease.active,
			upcoming: lease.upcoming
		}))
	};
};

export const actions: Actions = {
	delete: async ({ locals, params }) => {
		const context = auditContext(locals);
		const tenant = await getTenant(locals.db, context.accountId, params.id);
		if (!tenant) error(404, 'Diesen Mieter gibt es nicht.');
		const outcome = await deleteTenant(locals.db, context.accountId, tenant.id);
		if (outcome === 'in-use') {
			return fail(400, {
				deleteError:
					'Dieser Mieter steht auf einem Mietvertrag und kann nicht gelöscht werden. Lösche zuerst den Vertrag oder nimm den Mieter dort heraus.'
			});
		}
		if (outcome === 'missing') error(404, 'Diesen Mieter gibt es nicht.');
		await logChange(
			locals.db,
			context,
			'tenant',
			tenant.id,
			'delete',
			`Mieter ${personName(tenant)} gelöscht`
		);
		redirect(303, '/mieter');
	}
};
