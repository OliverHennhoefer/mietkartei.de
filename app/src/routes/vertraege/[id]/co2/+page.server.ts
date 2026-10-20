import { error, fail } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { parseCo2Split } from '#lib/forms/co2.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import {
	createCo2Split,
	deleteCo2Split,
	listCo2Splits,
	type Co2SplitInput
} from '#lib/server/co2.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// The CO₂ tab of a lease. The layout has already answered 404 for a lease of another account;
// the server module filters by account again.
export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const date = today();
	return {
		splits: await listCo2Splits(locals.db, accountId, params.id),
		defaults: { year: Number(date.slice(0, 4)) - 1, claimedOn: date }
	};
};

export const actions: Actions = {
	create: async ({ request, locals, params }) => {
		const result = parseCo2Split(await request.formData());
		if (!result.ok) {
			return fail(400, { errors: result.errors, values: result.values, hint: result.hint });
		}
		const created = await createCo2Split(locals.db, auditContext(locals), params.id, result.data);
		if (!created.ok && created.reason === 'missing') {
			error(404, 'Diesen Mietvertrag gibt es nicht.');
		}
		if (!created.ok) {
			const errors: FieldErrors<Co2SplitInput> = {
				year: `Für ${result.data.year} gibt es schon eine CO₂-Kostenaufteilung. Lösche sie unten, wenn du sie neu erfassen willst.`
			};
			return fail(400, { errors, values: result.values, hint: null });
		}
		return { created: { year: result.data.year, amount: created.amount } };
	},

	delete: async ({ request, locals }) => {
		const form = await request.formData();
		const splitId = form.get('splitId');
		if (typeof splitId !== 'string' || !splitId) {
			error(404, 'Diese CO₂-Kostenaufteilung gibt es nicht.');
		}
		const outcome = await deleteCo2Split(locals.db, auditContext(locals), splitId);
		if (outcome === 'missing') error(404, 'Diese CO₂-Kostenaufteilung gibt es nicht.');
		return { deleted: true };
	}
};
