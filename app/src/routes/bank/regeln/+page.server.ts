import { error, fail, redirect } from '@sveltejs/kit';
import { parseRule, type RuleInput } from '#lib/forms/bank.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import {
	confirmRule,
	createRule,
	deleteRule,
	listRules,
	updateRule
} from '#lib/server/bank/rules.ts';
import { leaseOptions } from '#lib/server/bank/transactions.ts';
import { listLeases } from '#lib/server/leases.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Zuordnungsregeln: two queries per page (the rules, the leases with their units and tenants).
// ?bearbeiten=<id> opens the rule in the edit dialog.
export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const [rules, leases] = await Promise.all([
		listRules(locals.db, accountId),
		listLeases(locals.db, accountId)
	]);
	const editing = rules.find((rule) => rule.id === url.searchParams.get('bearbeiten')) ?? null;
	return { rules, editing, leases: leaseOptions(leases) };
};

const missing = 'Diese Zuordnungsregel gibt es nicht.';

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
			error(404, missing);
		}
		return { confirmed: true };
	},

	update: async ({ request, locals }) => {
		const form = await request.formData();
		const result = parseRule(form);
		if (!result.ok) return fail(400, { edit: true, errors: result.errors, values: result.values });
		const outcome = await updateRule(locals.db, auditContext(locals), idOf(form), result.data);
		if (!outcome.ok) {
			if (outcome.reason === 'missing') error(404, missing);
			const { leaseId, field, pattern, confirmed } = result.data;
			const errors: FieldErrors<RuleInput> = { leaseId: 'Diesen Mietvertrag gibt es nicht.' };
			return fail(400, {
				edit: true,
				errors,
				values: { leaseId, field, pattern, confirmed: confirmed ? 'on' : '' }
			});
		}
		redirect(303, '/bank/regeln');
	},

	delete: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (!(await deleteRule(locals.db, auditContext(locals), id))) error(404, missing);
		redirect(303, '/bank/regeln');
	}
};
