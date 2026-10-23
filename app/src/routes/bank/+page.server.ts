import { error, fail } from '@sveltejs/kit';
import { suggestLease, type SuggestionSource } from '#lib/domain/bank-matching.ts';
import { parseAssignment, type AssignmentFields } from '#lib/forms/bank.ts';
import { parseExpenseAssignment } from '#lib/forms/expenses.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import { listBankAccounts } from '#lib/server/bank/accounts.ts';
import { listRules } from '#lib/server/bank/rules.ts';
import {
	assignExpense,
	assignTransaction,
	countUnmatched,
	getTransaction,
	ignoreTransaction,
	leaseByIban,
	leaseHints,
	leaseOptions,
	listAssignments,
	listTransactions,
	reopenTransaction,
	undoAssignment,
	type Assignment
} from '#lib/server/bank/transactions.ts';
import { bankTransactionStatuses, type BankTransactionStatus } from '#lib/server/db/schema.ts';
import { scopeOptions } from '#lib/server/expenses.ts';
import { listLeases } from '#lib/server/leases.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Umsätze: the review list. A fixed number of queries whatever the page shows: the bank
// accounts, the transactions, the open count, the leases (with units and tenants), the rules,
// the earlier assignments by IBAN, the properties and units for the expense select, and the
// payments, deposit movements and expenses of the listed rows.

export type StatusFilter = BankTransactionStatus | 'all';

export type Suggestion = { leaseId: string; source: SuggestionSource };

function statusOf(value: string | null): StatusFilter {
	return value === 'all' || (bankTransactionStatuses as readonly string[]).includes(value ?? '')
		? (value as StatusFilter)
		: 'unmatched';
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	// ?umsatz= shows the one transaction a payment or deposit movement links to, whatever its
	// status, so its assignment can be undone without searching the list.
	const transactionId = url.searchParams.get('umsatz') || null;
	const status = transactionId ? 'all' : statusOf(url.searchParams.get('status'));
	const bankAccountId = transactionId ? null : url.searchParams.get('konto') || null;

	const [bankAccounts, listed, openCount, leases, rules, byIban, scopes] = await Promise.all([
		listBankAccounts(locals.db, accountId),
		listTransactions(locals.db, accountId, { status, bankAccountId, transactionId }),
		countUnmatched(locals.db, accountId),
		listLeases(locals.db, accountId),
		listRules(locals.db, accountId),
		leaseByIban(locals.db, accountId),
		scopeOptions(locals.db, accountId)
	]);
	const assignments = await listAssignments(
		locals.db,
		accountId,
		listed.rows.map((row) => row.id)
	);
	const hints = leaseHints(leases);
	const transactions = listed.rows.map((row) => ({
		...row,
		suggestion:
			row.status === 'unmatched'
				? (suggestLease(row, { rules, leaseByIban: byIban, leases: hints }) ?? null)
				: null,
		assignments: (assignments.get(row.id) ?? []) as Assignment[]
	}));
	return {
		status,
		bankAccountId,
		transactionId,
		bankAccounts,
		transactions,
		more: listed.more,
		openCount,
		leases: leaseOptions(leases),
		scopes
	};
};

function notFound(): never {
	error(404, 'Diesen Umsatz gibt es nicht.');
}

/** The string fields of a form, for re-rendering a row after a refusal. */
function stringValues(form: FormData): Record<string, string> {
	const values: Record<string, string> = {};
	for (const [name, value] of form.entries()) if (typeof value === 'string') values[name] = value;
	return values;
}

const assignMessages = {
	'not-open': 'Dieser Umsatz ist nicht mehr offen.',
	'unknown-lease': 'Diesen Mietvertrag gibt es nicht.',
	'amount-mismatch': 'Die Beträge ergeben nicht den Betrag des Umsatzes.'
} as const;

export const actions: Actions = {
	assign: async ({ request, locals }) => {
		const accountId = requireAccount(locals);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const transaction = await getTransaction(locals.db, accountId, id);
		if (!transaction) notFound();
		const result = parseAssignment(form, transaction.amount);
		if (!result.ok) return fail(400, { id, errors: result.errors, values: result.values });
		const outcome = await assignTransaction(locals.db, auditContext(locals), id, result.data);
		if (outcome === 'missing') notFound();
		if (outcome !== 'assigned') {
			const errors: FieldErrors<AssignmentFields> = { leaseId: assignMessages[outcome] };
			return fail(400, { id, errors, values: stringValues(form) });
		}
		return { assigned: id };
	},

	expense: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const result = parseExpenseAssignment(form);
		if (!result.ok) {
			return fail(400, { id, expenseErrors: result.errors, values: result.values });
		}
		const outcome = await assignExpense(locals.db, auditContext(locals), id, result.data);
		if (outcome === 'missing') notFound();
		if (outcome !== 'assigned') {
			const message =
				outcome === 'not-open'
					? 'Dieser Umsatz ist nicht mehr offen.'
					: 'Diese Zuordnung gibt es nicht.';
			return fail(400, { id, expenseErrors: { scope: message }, values: result.values });
		}
		return { assigned: id };
	},

	ignore: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		const outcome = await ignoreTransaction(locals.db, auditContext(locals), id);
		if (outcome === 'missing') notFound();
		if (outcome === 'not-open') return fail(400, { id, message: 'Dieser Umsatz ist nicht offen.' });
		return { ignored: id };
	},

	undo: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		const outcome = await undoAssignment(locals.db, auditContext(locals), id);
		if (outcome === 'missing') notFound();
		if (outcome === 'not-matched') {
			return fail(400, { id, message: 'Dieser Umsatz ist nicht zugeordnet.' });
		}
		return { undone: id };
	},

	reopen: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		const outcome = await reopenTransaction(locals.db, auditContext(locals), id);
		if (outcome === 'missing') notFound();
		if (outcome === 'not-ignored') {
			return fail(400, { id, message: 'Dieser Umsatz ist nicht ignoriert.' });
		}
		return { reopened: id };
	}
};
