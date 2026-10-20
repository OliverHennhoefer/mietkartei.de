import { error, fail } from '@sveltejs/kit';
import { parseIndexValue } from '#lib/forms/rent.ts';
import { addIndexValue, deleteIndexValue, listIndexValues } from '#lib/server/rent-adjustments.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	return { values: await listIndexValues(locals.db, accountId) };
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const result = parseIndexValue(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const outcome = await addIndexValue(locals.db, auditContext(locals), result.data);
		if (!outcome.ok) {
			const { month, value, baseYear } = result.data;
			return fail(400, {
				refusal: outcome.message,
				values: { month, value: String(value).replace('.', ','), baseYear }
			});
		}
		return { added: result.data.month };
	},

	delete: async ({ request, locals }) => {
		const id = (await request.formData()).get('id');
		if (typeof id !== 'string' || !id) error(404, 'Diesen Wert gibt es nicht.');
		if (!(await deleteIndexValue(locals.db, auditContext(locals), id))) {
			error(404, 'Diesen Wert gibt es nicht.');
		}
		return { deleted: true };
	}
};
