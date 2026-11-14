import { fail } from '@sveltejs/kit';
import { privacyNotice } from '#lib/domain/applicants.ts';
import { parseSelfDisclosure, selfDisclosureValues } from '#lib/forms/lettings.ts';
import { disclosureByToken, submitDisclosure } from '#lib/server/lettings.ts';
import type { Actions, PageServerLoad } from './$types';

// The Mieterselbstauskunft behind the secret link the landlord sends: the applicant fills it in
// without an account, once. The token in the path is the only credential; an unknown, expired or
// used link shows a notice instead of the form. Nothing of the landlord's account is shown apart
// from the unit, its terms and the landlord as controller in the Datenschutzhinweis.

export const load: PageServerLoad = async ({ locals, params, setHeaders }) => {
	// The page holds the applicant's name and contact, and the applicant is not signed in, so the
	// app's no-store for signed-in pages does not apply on its own.
	setHeaders({ 'cache-control': 'private, no-store' });
	const page = await disclosureByToken(locals.db, params.token);
	if (!page) return { state: 'invalid' as const };
	// A used link shows only the thank-you note: it must not keep serving the answers.
	if (page.submitted) return { state: 'submitted' as const };
	const { applicant, letting, address, landlord } = page;
	return {
		state: 'open' as const,
		offer: {
			unit: letting.unit.name,
			address: `${address.street}, ${address.postalCode} ${address.city}`,
			baseRent: letting.baseRent,
			operatingCostPrepayment: letting.operatingCostPrepayment,
			heatingCostPrepayment: letting.heatingCostPrepayment,
			availableFrom: letting.availableFrom,
			requiresWbs: letting.requiresWbs
		},
		landlordName: landlord.name,
		notice: privacyNotice(landlord),
		values: selfDisclosureValues(applicant)
	};
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		const result = parseSelfDisclosure(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		if (!(await submitDisclosure(locals.db, params.token, result.data))) {
			return fail(400, { invalid: true });
		}
		return { sent: true };
	}
};
