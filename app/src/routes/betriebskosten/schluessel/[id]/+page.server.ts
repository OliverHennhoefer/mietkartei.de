import { error, fail, redirect } from '@sveltejs/kit';
import type { FieldErrors } from '#lib/forms/fields.ts';
import {
	formValues,
	keyErrorField,
	keyMessages,
	parseKey,
	parseKeyShares
} from '#lib/forms/operating-costs.ts';
import type { AllocationKeyInput } from '#lib/server/operating-costs.ts';
import {
	deleteKey,
	ensureDefaults,
	getKey,
	listKeyShares,
	replaceKeyShares,
	updateKey
} from '#lib/server/operating-costs.ts';
import { listProperties, listUnits } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { pluralize } from '#lib/format.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	await ensureDefaults(locals.db, accountId);
	const key = await getKey(locals.db, accountId, params.id);
	if (!key) error(404, keyMessages.missing);
	const properties = await listProperties(locals.db, accountId);
	// Shares exist for a custom key of one property: one input per unit of that property.
	const custom = key.kind === 'custom' && key.propertyId !== null;
	const [units, shares] = custom
		? await Promise.all([
				listUnits(locals.db, accountId, key.propertyId!),
				listKeyShares(locals.db, accountId, key.id)
			])
		: [[], []];
	return { key, properties, units, shares };
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const form = await request.formData();
		const result = parseKey(form);
		if (!result.ok)
			return fail(400, { form: 'key' as const, errors: result.errors, values: formValues(form) });
		const updated = await updateKey(locals.db, auditContext(locals), params.id, result.data);
		if (!updated.ok) {
			if (updated.reason === 'missing') error(404, keyMessages.missing);
			const errors: FieldErrors<AllocationKeyInput> = {};
			errors[keyErrorField(updated.reason)] = keyMessages[updated.reason];
			return fail(400, { form: 'key' as const, errors, values: formValues(form) });
		}
		redirect(303, `/betriebskosten/schluessel/${params.id}`);
	},
	shares: async ({ request, locals, params }) => {
		const accountId = requireAccount(locals);
		const key = await getKey(locals.db, accountId, params.id);
		if (!key) error(404, keyMessages.missing);
		if (key.kind !== 'custom' || !key.propertyId) {
			return fail(400, {
				form: 'shares' as const,
				refused: 'Anteile gibt es nur für eigene Schlüssel eines Objekts.'
			});
		}
		const units = await listUnits(locals.db, accountId, key.propertyId);
		const result = parseKeyShares(
			await request.formData(),
			units.map((unit) => unit.id)
		);
		if (!result.ok) {
			return fail(400, {
				form: 'shares' as const,
				shareErrors: result.errors,
				shareValues: result.values
			});
		}
		const outcome = await replaceKeyShares(
			locals.db,
			auditContext(locals),
			key.id,
			result.data.shares
		);
		if (outcome !== 'updated') {
			return fail(400, {
				form: 'shares' as const,
				refused: 'Die Anteile konnten nicht gespeichert werden.'
			});
		}
		return { form: 'shares' as const, saved: true };
	},
	delete: async ({ locals, params }) => {
		const key = await getKey(locals.db, requireAccount(locals), params.id);
		if (!key) error(404, keyMessages.missing);
		const outcome = await deleteKey(locals.db, auditContext(locals), params.id);
		if (outcome === 'in-use') {
			return fail(400, {
				form: 'delete' as const,
				refused: `Der Umlageschlüssel wird von ${pluralize(key.costItemCount, 'Beleg', 'Belegen')} verwendet und kann nicht gelöscht werden. Ordne den Belegen zuerst einen anderen Schlüssel zu.`
			});
		}
		redirect(303, '/betriebskosten/schluessel');
	}
};
