import { fail, redirect } from '@sveltejs/kit';
import type { FieldErrors } from '#lib/forms/fields.ts';
import { formValues, keyErrorField, keyMessages, parseKey } from '#lib/forms/operating-costs.ts';
import type { AllocationKeyInput } from '#lib/server/operating-costs.ts';
import { createKey, ensureDefaults, listKeys } from '#lib/server/operating-costs.ts';
import { listProperties } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	await ensureDefaults(locals.db, accountId);
	const [keys, properties] = await Promise.all([
		listKeys(locals.db, accountId),
		listProperties(locals.db, accountId, { archived: true })
	]);
	return { keys, properties };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const result = parseKey(form);
		if (!result.ok) return fail(400, { errors: result.errors, values: formValues(form) });
		const created = await createKey(locals.db, auditContext(locals), result.data);
		if (!created.ok) {
			const errors: FieldErrors<AllocationKeyInput> = {};
			errors[keyErrorField(created.reason)] = keyMessages[created.reason];
			return fail(400, { errors, values: formValues(form) });
		}
		redirect(303, `/betriebskosten/schluessel/${created.id}`);
	}
};
