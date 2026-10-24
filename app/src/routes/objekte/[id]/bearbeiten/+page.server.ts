import { error, fail, redirect } from '@sveltejs/kit';
import { deleteProperty, propertyDeletion } from '#lib/server/deletion.ts';
import { updateProperty } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { parseProperty } from '#lib/validation.ts';
import type { Actions, PageServerLoad } from './$types';

// The property comes from +layout.server.ts (data.property), which answers 404.
export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	return { deletion: await propertyDeletion(locals.db, accountId, params.id) };
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const result = parseProperty(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const updated = await updateProperty(locals.db, auditContext(locals), params.id, result.data);
		if (!updated) error(404, 'Dieses Objekt gibt es nicht.');
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
