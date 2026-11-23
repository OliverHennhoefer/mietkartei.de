import { error, fail, redirect } from '@sveltejs/kit';
import { parseRule, type RuleFields, type RuleInput } from '#lib/forms/bank.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import { contraAccountLabel, listContraAccounts } from '#lib/server/bank/contra-accounts.ts';
import {
	confirmRule,
	createRule,
	deleteRule,
	listRules,
	updateRule,
	type RuleRefusal
} from '#lib/server/bank/rules.ts';
import { leaseOptions } from '#lib/server/bank/transactions.ts';
import { listLeases } from '#lib/server/leases.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Zuordnungsregeln: three queries per page (the rules, the leases with their units and tenants,
// the Gegenkonten). ?bearbeiten=<id> opens the rule in the edit dialog.
export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const [rules, leases, contraAccounts] = await Promise.all([
		listRules(locals.db, accountId),
		listLeases(locals.db, accountId),
		listContraAccounts(locals.db, accountId)
	]);
	const editing = rules.find((rule) => rule.id === url.searchParams.get('bearbeiten')) ?? null;
	return {
		rules,
		editing,
		leases: leaseOptions(leases),
		// Rent and deposits go to a lease; a rule books only expenses and other bookings to a Gegenkonto.
		contraAccounts: contraAccounts
			.filter((account) => !leaseKinds.has(account.kind))
			.map((account) => ({ id: account.id, label: contraAccountLabel(account) })),
		contraLabels: Object.fromEntries(
			contraAccounts.map((account) => [account.id, contraAccountLabel(account)])
		)
	};
};

const leaseKinds = new Set<string>(['rent', 'operating_costs', 'statement_balance', 'deposit']);

const refusals: Record<RuleRefusal, string> = {
	'unknown-lease': 'Diesen Mietvertrag gibt es nicht.',
	'unknown-contra-account': 'Dieses Gegenkonto gibt es nicht.',
	'rent-contra-account': 'Mieten und Kautionen ordnet eine Regel einem Mietvertrag zu.'
};

/** The form values of a parsed rule, for re-rendering it after a refusal. */
function valuesOf(rule: RuleInput): Record<string, string> {
	return {
		name: rule.name,
		target: rule.leaseId ? `lease:${rule.leaseId}` : `contra:${rule.contraAccountId}`,
		field: rule.field,
		pattern: rule.pattern,
		confirmed: rule.confirmed ? 'on' : ''
	};
}

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
			const errors: FieldErrors<RuleFields> = { target: refusals[outcome.reason] };
			return fail(400, { errors, values: valuesOf(result.data) });
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
			const errors: FieldErrors<RuleFields> = { target: refusals[outcome.reason] };
			return fail(400, { edit: true, errors, values: valuesOf(result.data) });
		}
		redirect(303, '/bank/regeln');
	},

	delete: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (!(await deleteRule(locals.db, auditContext(locals), id))) error(404, missing);
		redirect(303, '/bank/regeln');
	}
};
