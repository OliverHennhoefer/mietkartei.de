import { fail, redirect } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import { parseNewStatement, type NewStatementInput } from '#lib/forms/statements.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import {
	createStatement,
	listPropertiesForStatements,
	listStatements
} from '#lib/server/statements.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	const [groups, properties] = await Promise.all([
		listStatements(locals.db, accountId),
		listPropertiesForStatements(locals.db, accountId)
	]);
	// A statement usually covers the last calendar year.
	const lastYear = Number(today().slice(0, 4)) - 1;
	return {
		groups,
		properties,
		defaults: { periodStart: `${lastYear}-01-01`, periodEnd: `${lastYear}-12-31` }
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const result = parseNewStatement(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const created = await createStatement(locals.db, auditContext(locals), result.data);
		if (!created.ok) {
			// The same shape as a parser failure, so the page reads one `form` type.
			const errors: FieldErrors<NewStatementInput> = { propertyId: created.message };
			return fail(400, {
				errors,
				values: {
					propertyId: result.data.propertyId,
					periodStart: result.data.periodStart,
					periodEnd: result.data.periodEnd
				}
			});
		}
		redirect(303, `/betriebskosten/abrechnungen/${created.id}`);
	}
};
