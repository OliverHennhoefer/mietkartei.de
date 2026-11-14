import { fail, redirect } from '@sveltejs/kit';
import { parseLetting } from '#lib/forms/lettings.ts';
import { formatCentsPlain } from '#lib/money.ts';
import { listUnitsWithProperty } from '#lib/server/leases.ts';
import { createLetting, lettingDefaults, openLettingOfUnit } from '#lib/server/lettings.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// A new Neuvermietung. ?unitId= picks the unit (the suggestions and the unit page link here, and
// changing the select reloads with it); the terms start from the unit's latest lease.
export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const units = await listUnitsWithProperty(locals.db, accountId);
	const unitId = url.searchParams.get('unitId') ?? '';
	const chosen = units.find((row) => row.unit.id === unitId);
	if (!chosen) {
		return { units, defaults: { unitId: '' } as Record<string, string>, openLettingId: null };
	}
	const [terms, openLettingId] = await Promise.all([
		lettingDefaults(locals.db, accountId, unitId),
		openLettingOfUnit(locals.db, accountId, unitId)
	]);
	return {
		units,
		openLettingId: openLettingId ?? null,
		defaults: <Record<string, string>>{
			unitId,
			availableFrom: terms.availableFrom ?? '',
			baseRent: terms.baseRent ? formatCentsPlain(terms.baseRent) : '',
			operatingCostPrepayment: terms.operatingCostPrepayment
				? formatCentsPlain(terms.operatingCostPrepayment)
				: '',
			heatingCostPrepayment: terms.heatingCostPrepayment
				? formatCentsPlain(terms.heatingCostPrepayment)
				: '',
			securityDeposit: terms.securityDeposit ? formatCentsPlain(terms.securityDeposit) : ''
		}
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const result = parseLetting(form);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const created = await createLetting(locals.db, auditContext(locals), result.data);
		if (!created.ok) {
			return fail(400, {
				values: Object.fromEntries(
					[...form].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
				),
				errors: {
					unitId:
						created.reason === 'open-exists'
							? 'Für diese Einheit läuft schon eine Neuvermietung.'
							: 'Diese Einheit gibt es nicht.'
				}
			});
		}
		redirect(303, `/vermietung/${created.id}`);
	}
};
