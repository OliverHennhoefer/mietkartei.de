import { error, fail, redirect } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { archiveTenant, restoreTenant, tenantArchiving } from '#lib/server/archive.ts';
import { listLeases } from '#lib/server/leases.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { deleteTenant, tenantDeletion } from '#lib/server/deletion.ts';
import { tenantDossier } from '#lib/server/tenant-dossier.ts';
import { getTenant } from '#lib/server/tenants.ts';
import type { Actions, PageServerLoad } from './$types';

// The tenant as a dossier: the key figures first, then money, leases, letters, tasks,
// documents and the history across all the tenant's leases (see tenant-dossier.ts).
export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const tenant = await getTenant(locals.db, accountId, params.id);
	if (!tenant) error(404, 'Diesen Mieter gibt es nicht.');
	const date = today();
	const leases = await listLeases(locals.db, accountId, { tenantId: tenant.id });
	const [dossier, archiving, deletion] = await Promise.all([
		tenantDossier(locals.db, accountId, tenant.id, leases, date),
		tenantArchiving(locals.db, accountId, tenant.id, date),
		tenantDeletion(locals.db, accountId, tenant.id)
	]);
	if (!archiving) error(404, 'Diesen Mieter gibt es nicht.');
	return { tenant, archiving, deletion, dossier };
};

export const actions: Actions = {
	archive: async ({ locals, params }) => {
		const outcome = await archiveTenant(locals.db, auditContext(locals), params.id, today());
		if (outcome === 'missing') error(404, 'Diesen Mieter gibt es nicht.');
		if (outcome === 'in-use') {
			return fail(400, {
				archiveError:
					'Das Archivieren geht nicht mehr, weil inzwischen ein Mietvertrag läuft; er steht unten.'
			});
		}
		redirect(303, '/mieter');
	},
	restore: async ({ locals, params }) => {
		if (!(await restoreTenant(locals.db, auditContext(locals), params.id))) {
			error(404, 'Diesen Mieter gibt es nicht.');
		}
		redirect(303, `/mieter/${params.id}`);
	},
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
