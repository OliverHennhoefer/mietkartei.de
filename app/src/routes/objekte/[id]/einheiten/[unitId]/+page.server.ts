import { error, fail, redirect } from '@sveltejs/kit';
import { listLeases } from '#lib/server/leases.ts';
import { deleteUnit, unitDeletion } from '#lib/server/deletion.ts';
import { getUnit } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// The property comes from +layout.server.ts; the unit must belong to it, else 404.
export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const unit = await getUnit(locals.db, accountId, params.unitId);
	if (!unit || unit.propertyId !== params.id) error(404, 'Diese Einheit gibt es nicht.');
	const [leases, deletion] = await Promise.all([
		listLeases(locals.db, accountId, { unitId: unit.id }),
		unitDeletion(locals.db, accountId, unit.id)
	]);
	return {
		unit,
		deletion,
		leases: leases.map((lease) => ({
			id: lease.id,
			startDate: lease.startDate,
			endDate: lease.endDate,
			active: lease.active,
			upcoming: lease.upcoming,
			main: lease.unitId === unit.id,
			tenants: lease.tenants
		}))
	};
};

export const actions: Actions = {
	delete: async ({ locals, params }) => {
		const accountId = requireAccount(locals);
		const unit = await getUnit(locals.db, accountId, params.unitId);
		if (!unit || unit.propertyId !== params.id) error(404, 'Diese Einheit gibt es nicht.');
		const outcome = await deleteUnit(locals.db, auditContext(locals), unit.id);
		if (outcome === 'missing') error(404, 'Diese Einheit gibt es nicht.');
		if (outcome === 'in-use') {
			return fail(400, {
				deleteError:
					'Das Löschen geht nicht mehr, weil sich inzwischen etwas geändert hat; die Gründe stehen unten.'
			});
		}
		redirect(303, `/objekte/${params.id}`);
	}
};
