import { error, fail, redirect } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { parseDepreciation, parseLoanInterest } from '#lib/forms/tax.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { loadTaxOverview, saveDepreciation, saveLoanInterest } from '#lib/server/tax.ts';
import { taxYearOf } from './year';
import type { Actions, PageServerLoad } from './$types';

// The Steuerübersicht of the property for one year: ?jahr=2025, by default last year, the one a
// tax return is usually made for.

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const accountId = requireAccount(locals);
	const { property } = await parent();
	const year = taxYearOf(url.searchParams.get('jahr'), today());
	return { year, tax: await loadTaxOverview(locals.db, accountId, property, year) };
};

export const actions: Actions = {
	depreciation: async ({ request, locals, params }) => {
		const formData = await request.formData();
		const result = parseDepreciation(formData);
		if (!result.ok) {
			return fail(400, { form: 'depreciation', errors: result.errors, values: result.values });
		}
		const saved = await saveDepreciation(locals.db, auditContext(locals), params.id, result.data);
		if (!saved) error(404, 'Dieses Objekt gibt es nicht.');
		// Back to the year the form was sent from.
		const year = taxYearOf(String(formData.get('year') ?? ''), today());
		redirect(303, `/objekte/${params.id}/steuer?jahr=${year}`);
	},
	interest: async ({ request, locals, params }) => {
		const result = parseLoanInterest(await request.formData());
		if (!result.ok) {
			return fail(400, { form: 'interest', errors: result.errors, values: result.values });
		}
		const { year, loanInterest } = result.data;
		const saved = await saveLoanInterest(
			locals.db,
			auditContext(locals),
			params.id,
			year,
			loanInterest
		);
		if (!saved) error(404, 'Dieses Objekt gibt es nicht.');
		redirect(303, `/objekte/${params.id}/steuer?jahr=${year}`);
	}
};
