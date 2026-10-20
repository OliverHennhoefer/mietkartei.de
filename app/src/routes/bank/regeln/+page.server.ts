import { error, fail } from '@sveltejs/kit';
import { parseRule, type RuleInput } from '#lib/forms/bank.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import { confirmRule, createRule, deleteRule, listRules } from '#lib/server/bank/rules.ts';
import { leaseOptions } from '#lib/server/bank/transactions.ts';
import { listLeases } from '#lib/server/leases.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Zuordnungsregeln: two queries per page (the rules, the leases with their units and tenants).
export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	const [rules, leases] = await Promise.all([
		listRules(locals.db, accountId),
		listLeases(locals.db, accountId)
	]);
	return { rules, leases: leaseOptions(leases) };
};

function idOf(form: FormData): string {
	return String(form.get('id') ?? '');
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const result = parseRule(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const outcome = await createRule(locals.db, auditContext(locals), result.data);
		if (!outcome.ok) {
			const { leaseId, field, pattern, confirmed } = result.data;
			const errors: FieldErrors<RuleInput> = { leaseId: 'Diesen Mietvertrag gibt es nicht.' };
			return fail(400, {
				errors,
				values: { leaseId, field, pattern, confirmed: confirmed ? 'on' : '' }
			});
		}
		return { created: true };
	},

	confirm: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (!(await confirmRule(locals.db, auditContext(locals), id))) {
			error(404, 'Diese Zuordnungsregel gibt es nicht.');
		}
		return { confirmed: true };
	},

	delete: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (!(await deleteRule(locals.db, auditContext(locals), id))) {
			error(404, 'Diese Zuordnungsregel gibt es nicht.');
		}
		return { deleted: true };
	}
};
