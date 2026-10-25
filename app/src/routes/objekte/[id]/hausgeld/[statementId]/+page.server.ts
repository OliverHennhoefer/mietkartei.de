import { error, fail, redirect } from '@sveltejs/kit';
import {
	associationStatementInput,
	associationStatementMessages,
	parseAssociationStatement
} from '#lib/forms/association-statements.ts';
import {
	deleteAssociationStatement,
	getAssociationStatement,
	updateAssociationStatement
} from '#lib/server/association-statements.ts';
import { formValues } from '#lib/forms/operating-costs.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

const missing = associationStatementMessages.missing;

/** The statement, only when it belongs to the property of the URL. */
async function statementOf(locals: App.Locals, propertyId: string, statementId: string) {
	const statement = await getAssociationStatement(locals.db, requireAccount(locals), statementId);
	if (!statement || statement.propertyId !== propertyId) error(404, missing);
	return statement;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	return { statement: await statementOf(locals, params.id, params.statementId) };
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		await statementOf(locals, params.id, params.statementId);
		const formData = await request.formData();
		const result = parseAssociationStatement(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const updated = await updateAssociationStatement(
			locals.db,
			auditContext(locals),
			params.statementId,
			associationStatementInput(result.data)
		);
		if (!updated.ok) {
			if (updated.reason === 'duplicate-period') {
				return fail(400, {
					errors: { periodStart: associationStatementMessages['duplicate-period'] },
					values: formValues(formData)
				});
			}
			error(404, missing);
		}
		redirect(303, `/objekte/${params.id}/hausgeld`);
	},
	delete: async ({ locals, params }) => {
		await statementOf(locals, params.id, params.statementId);
		await deleteAssociationStatement(locals.db, auditContext(locals), params.statementId);
		redirect(303, `/objekte/${params.id}/hausgeld`);
	}
};
