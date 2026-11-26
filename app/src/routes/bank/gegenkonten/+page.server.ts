import { error, fail, redirect } from '@sveltejs/kit';
import { stringValues } from '#lib/forms/fields.ts';
import { parseContraAccount, type ContraAccountFields } from '#lib/forms/contra-accounts.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import { today } from '#lib/dates.ts';
import {
	contraAccountTotals,
	createContraAccount,
	deleteContraAccount,
	listContraAccounts,
	updateContraAccount,
	type ContraAccountRefusal
} from '#lib/server/bank/contra-accounts.ts';
import { listProperties } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Gegenkonten: the landlord's own accounts of their bookkeeping, with what was booked to each
// in the year ?jahr= (default: this year). Six queries per page (the accounts, the properties,
// four sums). ?bearbeiten=<id> opens one in the edit dialog.
export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const thisYear = Number(today().slice(0, 4));
	const asked = Number(url.searchParams.get('jahr'));
	const year = Number.isInteger(asked) && asked >= 2000 && asked <= thisYear ? asked : thisYear;
	const [contraAccounts, properties, totals] = await Promise.all([
		listContraAccounts(locals.db, accountId),
		listProperties(locals.db, accountId, { archived: true }),
		contraAccountTotals(locals.db, accountId, year)
	]);
	const editing =
		contraAccounts.find((account) => account.id === url.searchParams.get('bearbeiten')) ?? null;
	return {
		contraAccounts,
		year,
		years: Array.from({ length: 6 }, (_, index) => thisYear - index),
		totals: Object.fromEntries(
			[...totals].map(([id, total]) => [id ?? 'none', total] as const)
		) as Record<string, { amount: number; count: number }>,
		editing,
		properties: properties.map((property) => ({
			id: property.id,
			name: property.archivedAt ? `${property.name} (archiviert)` : property.name
		}))
	};
};

const missing = 'Dieses Gegenkonto gibt es nicht.';

const refusals: Record<ContraAccountRefusal, FieldErrors<ContraAccountFields>> = {
	'unknown-property': { propertyId: 'Dieses Objekt gibt es nicht.' },
	'duplicate-number': { number: 'Ein Gegenkonto mit dieser Nummer gibt es schon.' }
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const result = parseContraAccount(form);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const outcome = await createContraAccount(locals.db, auditContext(locals), result.data);
		if (!outcome.ok) {
			return fail(400, { errors: refusals[outcome.reason], values: stringValues(form) });
		}
		return { created: true };
	},

	update: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const result = parseContraAccount(form);
		if (!result.ok) return fail(400, { edit: true, errors: result.errors, values: result.values });
		const outcome = await updateContraAccount(locals.db, auditContext(locals), id, result.data);
		if (!outcome.ok) {
			if (outcome.reason === 'missing') error(404, missing);
			return fail(400, {
				edit: true,
				errors: refusals[outcome.reason],
				values: stringValues(form)
			});
		}
		redirect(303, '/bank/gegenkonten');
	},

	delete: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!(await deleteContraAccount(locals.db, auditContext(locals), id))) error(404, missing);
		redirect(303, '/bank/gegenkonten');
	}
};
