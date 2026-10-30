import { error, fail, redirect } from '@sveltejs/kit';
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

// The CO₂ tab of a lease. The layout answers 404 for a lease of another account; the actions run
// without it, so the server module checks the account and they only ever touch params.id.
// ?bearbeiten=<id> opens a split in its dialog.
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const accountId = requireAccount(locals);
	const date = today();
	const splits = await listCo2Splits(locals.db, accountId, params.id);
	return {
		splits,
		editing: splits.find((split) => split.id === url.searchParams.get('bearbeiten')) ?? null,
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
				year: `Für ${result.data.year} gibt es schon eine CO₂-Kostenaufteilung. Öffne sie unten und lösche sie, wenn du sie neu erfassen willst.`
			};
			return fail(400, { errors, values: result.values, hint: null });
		}
		return { created: { year: result.data.year, amount: created.amount } };
	},

	delete: async ({ request, locals, params }) => {
		const form = await request.formData();
		const splitId = form.get('splitId');
		if (typeof splitId !== 'string' || !splitId || splitId.length > 64) {
			error(404, 'Diese CO₂-Kostenaufteilung gibt es nicht.');
		}
		const outcome = await deleteCo2Split(locals.db, auditContext(locals), params.id, splitId);
		if (outcome === 'missing') error(404, 'Diese CO₂-Kostenaufteilung gibt es nicht.');
		redirect(303, `/vertraege/${params.id}/co2`);
	}
};
