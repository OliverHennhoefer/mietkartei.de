import { error, fail, redirect } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { archiveProperty, propertyArchiving, restoreProperty } from '#lib/server/archive.ts';
import { deleteProperty, propertyDeletion } from '#lib/server/deletion.ts';
import { updateProperty } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { parseProperty } from '#lib/validation.ts';
import type { Actions, PageServerLoad } from './$types';

// The property comes from +layout.server.ts (data.property), which answers 404.
export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const [archiving, deletion] = await Promise.all([
		propertyArchiving(locals.db, accountId, params.id, today()),
		propertyDeletion(locals.db, accountId, params.id)
	]);
	if (!archiving) error(404, 'Dieses Objekt gibt es nicht.');
	return { archiving, deletion };
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const result = parseProperty(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const updated = await updateProperty(locals.db, auditContext(locals), params.id, result.data);
		if (!updated) error(404, 'Dieses Objekt gibt es nicht.');
		redirect(303, `/objekte/${params.id}`);
	},
	archive: async ({ locals, params }) => {
		const outcome = await archiveProperty(locals.db, auditContext(locals), params.id, today());
		if (outcome === 'missing') error(404, 'Dieses Objekt gibt es nicht.');
		if (outcome === 'in-use') {
			return fail(400, {
				archiveError:
					'Das Archivieren geht nicht mehr, weil inzwischen ein Mietvertrag läuft; er steht unten.'
			});
		}
		redirect(303, '/objekte');
	},
	restore: async ({ locals, params }) => {
		if (!(await restoreProperty(locals.db, auditContext(locals), params.id))) {
			error(404, 'Dieses Objekt gibt es nicht.');
		}
		redirect(303, `/objekte/${params.id}`);
	},
	delete: async ({ locals, params }) => {
		const outcome = await deleteProperty(locals.db, auditContext(locals), params.id);
		if (outcome === 'missing') error(404, 'Dieses Objekt gibt es nicht.');
		if (outcome === 'in-use') {
			return fail(400, {
				deleteError:
					'Das Löschen geht nicht mehr, weil sich inzwischen etwas geändert hat; die Gründe stehen unten.'
			});
		}
		redirect(303, '/objekte');
	}
};
