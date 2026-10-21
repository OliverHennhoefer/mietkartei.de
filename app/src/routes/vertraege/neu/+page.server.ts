import { fail, redirect } from '@sveltejs/kit';
import { depositWarning, parseLease } from '#lib/forms/leases.ts';
import { parseCents } from '#lib/money.ts';
import { createLease, listUnitsWithProperty } from '#lib/server/leases.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { listTenants } from '#lib/server/tenants.ts';
import type { Actions, PageServerLoad } from './$types';

// ?unitId= and ?tenantId= preselect the unit and the tenant (unit rows and tenant pages link
// here); a tenant created through /mieter/neu?return=/vertraege/neu comes back the same way.
export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const [units, tenants] = await Promise.all([
		listUnitsWithProperty(locals.db, accountId),
		listTenants(locals.db, accountId)
	]);
	const defaults: Record<string, string> = {
		unitId: url.searchParams.get('unitId') ?? '',
		tenantIds: url.searchParams.get('tenantId') ?? ''
	};
	return { units, tenants, defaults };
};

/** The form as typed, for re-rendering after a refusal that is not a field error. */
function valuesOf(form: FormData): Record<string, string> {
	const values: Record<string, string> = {};
	for (const [name, value] of form) {
		if (typeof value !== 'string') continue;
		values[name] = name in values ? `${values[name]},${value}` : value;
	}
	return values;
}

/** The § 551 hint for the values as typed, also when other fields failed. */
function warningFor(values: Record<string, string>): string | undefined {
	const baseRent = parseCents(values.baseRent ?? '');
	const securityDeposit = parseCents(values.securityDeposit ?? '');
	if (baseRent === undefined || securityDeposit === undefined) return undefined;
	const kind =
		values.kind === 'commercial' || values.kind === 'parking' ? values.kind : 'residential';
	return depositWarning({ kind, baseRent, securityDeposit });
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const context = auditContext(locals);
		const form = await request.formData();
		const lease = parseLease(form);
		if (!lease.ok) {
			const values = lease.values;
			return fail(400, { errors: lease.errors, values, depositWarning: warningFor(values) });
		}

		const result = await createLease(locals.db, context, lease.data);
		if (!result.ok) {
			const values = valuesOf(form);
			const errors =
				result.reason === 'unknown-unit'
					? { unitId: 'Diese Einheit gibt es nicht.' }
					: { tenantIds: 'Einen der Mieter gibt es nicht.' };
			return fail(400, { errors, values, depositWarning: warningFor(values) });
		}
		redirect(303, `/vertraege/${result.id}`);
	}
};
