import { fail, redirect } from '@sveltejs/kit';
import type { FieldErrors } from '#lib/forms/fields.ts';
import {
	categoryErrorField,
	categoryMessages,
	formValues,
	parseCategory
} from '#lib/forms/operating-costs.ts';
import type { CostCategoryInput } from '#lib/server/operating-costs.ts';
import {
	createCategory,
	ensureDefaults,
	listCategories,
	listCircles,
	listKeys
} from '#lib/server/operating-costs.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	await ensureDefaults(locals.db, accountId);
	const [categories, keys, circles] = await Promise.all([
		listCategories(locals.db, accountId),
		listKeys(locals.db, accountId),
		listCircles(locals.db, accountId)
	]);
	return { categories, keys, circles };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const result = parseCategory(form);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const created = await createCategory(locals.db, auditContext(locals), result.data);
		if (!created.ok) {
			const errors: FieldErrors<CostCategoryInput> = {};
			errors[categoryErrorField(created.reason)] = categoryMessages[created.reason];
			return fail(400, { errors, values: formValues(form) });
		}
		redirect(303, '/betriebskosten/kostenarten');
	}
};
