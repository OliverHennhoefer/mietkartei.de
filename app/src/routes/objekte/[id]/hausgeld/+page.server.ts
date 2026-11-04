import { error, fail, redirect } from '@sveltejs/kit';
import {
	associationStatementInput,
	associationStatementMessages,
	parseAssociationStatement
} from '#lib/forms/association-statements.ts';
import {
	createAssociationStatement,
	listAssociationStatements
} from '#lib/server/association-statements.ts';
import { formValues } from '#lib/forms/operating-costs.ts';
import { withDismissals } from '#lib/server/hints.ts';
import { auditContext, requireAccount, requireUser } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const accountId = requireAccount(locals);
	const { property } = await parent();
	const userId = requireUser(locals).id;
	const statements = await listAssociationStatements(locals.db, accountId, property.id);
	return {
		statements: await Promise.all(
			statements.map(async (statement) => ({
				...statement,
				findings: await withDismissals(
					locals.db,
					userId,
					`hausgeld:${statement.id}`,
					statement.findings
				)
			}))
		)
	};
};

export const actions: Actions = {
	create: async ({ request, locals, params }) => {
		const formData = await request.formData();
		const result = parseAssociationStatement(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const created = await createAssociationStatement(
			locals.db,
			auditContext(locals),
			params.id,
			associationStatementInput(result.data)
		);
		if (!created.ok) {
			if (created.reason === 'duplicate-period') {
				return fail(400, {
					errors: { periodStart: associationStatementMessages['duplicate-period'] },
					values: formValues(formData)
				});
			}
			error(404, associationStatementMessages[created.reason]);
		}
		redirect(303, `/objekte/${params.id}/hausgeld`);
	}
};
