import { fail } from '@sveltejs/kit';
import { privacyNotice } from '#lib/domain/applicants.ts';
import { parseSelfDisclosure } from '#lib/forms/lettings.ts';
import { formatCentsPlain } from '#lib/money.ts';
import { disclosureByToken, submitDisclosure } from '#lib/server/lettings.ts';
import type { Actions, PageServerLoad } from './$types';

// The Mieterselbstauskunft behind the secret link the landlord sends: the applicant fills it in
// without an account, once. The token in the path is the only credential; an unknown, expired or
// used link shows a notice instead of the form. Nothing of the landlord's account is shown apart
// from the unit, its terms and the landlord as controller in the Datenschutzhinweis.

const text = (value: string | null) => value ?? '';

export const load: PageServerLoad = async ({ locals, params, setHeaders }) => {
	// The page holds the applicant's name and contact, and the applicant is not signed in, so the
	// app's no-store for signed-in pages does not apply on its own.
	setHeaders({ 'cache-control': 'private, no-store' });
	const page = await disclosureByToken(locals.db, params.token);
	if (!page) return { state: 'invalid' as const };
	const { applicant, letting, address, landlord } = page;
	return {
		state: page.submitted ? ('submitted' as const) : ('open' as const),
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
		values: {
			salutation: text(applicant.salutation),
			firstName: applicant.firstName,
			lastName: applicant.lastName,
			email: text(applicant.email),
			phone: text(applicant.phone),
			street: text(applicant.street),
			postalCode: text(applicant.postalCode),
			city: text(applicant.city),
			birthDate: text(applicant.birthDate),
			adults: applicant.adults === null ? '' : String(applicant.adults),
			children: applicant.children === null ? '' : String(applicant.children),
			occupation: text(applicant.occupation),
			employer: text(applicant.employer),
			netIncome: applicant.netIncome === null ? '' : formatCentsPlain(applicant.netIncome),
			pets: text(applicant.pets),
			moveInDate: text(applicant.moveInDate)
		}
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
