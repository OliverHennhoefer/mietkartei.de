import { fail } from '@sveltejs/kit';
import { parseLandlord } from '#lib/forms/auth.ts';
import { getLandlord, updateLandlord } from '#lib/server/accounts.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// The landlord sender block, which the letters print. The answer names the form it belongs to,
// so the page shows errors and confirmations in place.

export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	return { landlord: await getLandlord(locals.db, accountId) };
};

export const actions: Actions = {
	landlord: async ({ request, locals }) => {
		const result = parseLandlord(await request.formData());
		if (!result.ok) {
			return fail(400, { form: 'landlord' as const, errors: result.errors, values: result.values });
		}
		await updateLandlord(locals.db, auditContext(locals), result.data);
		return { form: 'landlord' as const, saved: true };
	}
};
