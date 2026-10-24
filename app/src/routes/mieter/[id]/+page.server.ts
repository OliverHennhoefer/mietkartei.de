import { error, fail, redirect } from '@sveltejs/kit';
import { leaseLabel, listLeases } from '#lib/server/leases.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { deleteTenant, tenantDeletion } from '#lib/server/deletion.ts';
import { getTenant } from '#lib/server/tenants.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const tenant = await getTenant(locals.db, accountId, params.id);
	if (!tenant) error(404, 'Diesen Mieter gibt es nicht.');
	const [leases, deletion] = await Promise.all([
		listLeases(locals.db, accountId, { tenantId: tenant.id }),
		tenantDeletion(locals.db, accountId, tenant.id)
	]);
	return {
		tenant,
		deletion,
		leases: leases.map((lease) => ({
			id: lease.id,
			label: leaseLabel(lease),
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
		const outcome = await deleteTenant(locals.db, context, params.id);
		if (outcome === 'in-use') {
			return fail(400, {
				deleteError:
					'Das Löschen geht nicht mehr, weil sich inzwischen etwas geändert hat; die Gründe stehen unten.'
			});
		}
		if (outcome === 'missing') error(404, 'Diesen Mieter gibt es nicht.');
		redirect(303, '/mieter');
	}
};
