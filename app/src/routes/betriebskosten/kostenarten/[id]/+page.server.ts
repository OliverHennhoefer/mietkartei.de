import { error, fail, redirect } from '@sveltejs/kit';
import type { FieldErrors } from '#lib/forms/fields.ts';
import {
	categoryErrorField,
	categoryMessages,
	formValues,
	parseCategory
} from '#lib/forms/operating-costs.ts';
import type { CostCategoryInput } from '#lib/server/operating-costs.ts';
import {
	deleteCategory,
	ensureDefaults,
	getCategory,
	listCircles,
	listKeys,
	updateCategory
} from '#lib/server/operating-costs.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	await ensureDefaults(locals.db, accountId);
	const category = await getCategory(locals.db, accountId, params.id);
	if (!category) error(404, 'Diese Kostenart gibt es nicht.');
	const [keys, circles] = await Promise.all([
		listKeys(locals.db, accountId),
		listCircles(locals.db, accountId)
	]);
	return { category, keys, circles };
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const form = await request.formData();
		const result = parseCategory(form);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const updated = await updateCategory(locals.db, auditContext(locals), params.id, result.data);
		if (!updated.ok) {
			if (updated.reason === 'missing') error(404, categoryMessages.missing);
			const errors: FieldErrors<CostCategoryInput> = {};
			errors[categoryErrorField(updated.reason)] = categoryMessages[updated.reason];
			return fail(400, { errors, values: formValues(form) });
		}
		redirect(303, '/betriebskosten/kostenarten');
	},
	delete: async ({ locals, params }) => {
		const outcome = await deleteCategory(locals.db, auditContext(locals), params.id);
		if (outcome === 'missing') error(404, categoryMessages.missing);
		redirect(303, '/betriebskosten/kostenarten');
	}
};
