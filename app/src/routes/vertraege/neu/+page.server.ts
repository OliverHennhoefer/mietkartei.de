import { fail, redirect } from '@sveltejs/kit';
import { addMonthsToMonth, firstOfMonth, monthOf, today } from '#lib/dates.ts';
import { depositWarning, parseLease, parseOpeningBalance } from '#lib/forms/leases.ts';
import { parseCents } from '#lib/money.ts';
import { createLease, listUnitsWithProperty } from '#lib/server/leases.ts';
import { ensureCharges } from '#lib/server/ledger.ts';
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
	// A new lease usually starts on the first of next month.
	const defaults: Record<string, string> = {
		unitId: url.searchParams.get('unitId') ?? '',
		tenantIds: url.searchParams.get('tenantId') ?? '',
		startDate: firstOfMonth(addMonthsToMonth(monthOf(today()), 1))
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
		const opening = parseOpeningBalance(form);
		if (!lease.ok || !opening.ok) {
			const errors = {
				...(lease.ok ? {} : lease.errors),
				...(opening.ok ? {} : opening.errors)
			};
			// The whole form, so a refused opening balance alone does not empty the other fields.
			const values = valuesOf(form);
			return fail(400, { errors, values, depositWarning: warningFor(values) });
		}

		// A lease entered after it began keeps its old months out of the ledger: the account starts
		// with the current month unless the form says otherwise. A lease that began within the current
		// month keeps its start date; a ledger start before the lease began would be refused.
		const input = { ...lease.data };
		const start = firstOfMonth(monthOf(today()));
		if (input.ledgerStart === null && input.startDate < start) {
			if (input.endDate === null || start <= input.endDate) input.ledgerStart = start;
		}

		const result = await createLease(locals.db, context, input, opening.data.openingBalance);
		if (!result.ok) {
			const values = valuesOf(form);
			const errors =
				result.reason === 'unknown-unit'
					? { unitId: 'Diese Einheit gibt es nicht.' }
					: { tenantIds: 'Einen der Mieter gibt es nicht.' };
			return fail(400, { errors, values, depositWarning: warningFor(values) });
		}

		await ensureCharges(locals.db, context.accountId, [result.id]);
		redirect(303, `/vertraege/${result.id}`);
	}
};
