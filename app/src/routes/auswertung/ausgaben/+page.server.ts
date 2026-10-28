import { fail, redirect } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { parseExpense } from '#lib/forms/expenses.ts';
import {
	createExpense,
	deleteExpense,
	expenseScopeValue,
	expenseSuggestions,
	firstExpenseYear,
	listExpenses,
	scopeOptions,
	updateExpense
} from '#lib/server/expenses.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Ausgaben: the list of one year (default: the current one) and the form for an expense paid
// outside the imported bank accounts. Expenses from bank transactions are undone on /bank.

export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const date = today();
	const currentYear = Number(date.slice(0, 4));
	const requested = Number(url.searchParams.get('jahr'));
	const year =
		Number.isInteger(requested) && requested >= 1900 && requested <= currentYear + 1
			? requested
			: currentYear;
	const [expenses, scopes, firstYear, suggestions] = await Promise.all([
		listExpenses(locals.db, accountId, { from: `${year}-01-01`, to: `${year}-12-31` }),
		scopeOptions(locals.db, accountId),
		firstExpenseYear(locals.db, accountId),
		expenseSuggestions(locals.db, accountId)
	]);
	// The last six years, and back to the earliest expense, so every expense can be reached.
	const oldest = Math.min(currentYear - 5, firstYear ?? currentYear, year);
	const years: number[] = [];
	for (let candidate = Math.max(currentYear, year); candidate >= oldest; candidate--) {
		years.push(candidate);
	}
	// ?bearbeiten=<id> opens an expense of the year in the edit dialog; one from a bank
	// transaction is changed under Bank.
	const editing = expenses.find(
		(expense) => expense.id === url.searchParams.get('bearbeiten') && !expense.bankTransactionId
	);
	return {
		year,
		years,
		today: date,
		expenses,
		editing: editing ? { ...editing, scope: expenseScopeValue(editing) } : null,
		scopes,
		suggestions
	};
};

const missing = 'Diese Ausgabe gibt es nicht.';
const fromBank = 'Diese Ausgabe stammt aus einem Bankumsatz; hebe die Zuordnung unter Bank auf.';

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const result = parseExpense(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const created = await createExpense(locals.db, auditContext(locals), result.data);
		if (!created.ok) {
			return fail(400, {
				errors: { scope: 'Diese Zuordnung gibt es nicht.' },
				values: result.values
			});
		}
		return { created: created.id, year: Number(result.data.date.slice(0, 4)) };
	},
	update: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const result = parseExpense(form);
		if (!result.ok) return fail(400, { edit: true, errors: result.errors, values: result.values });
		const outcome = await updateExpense(locals.db, auditContext(locals), id, result.data);
		if (outcome === 'missing') return fail(404, { message: missing });
		if (outcome === 'from-bank') return fail(400, { message: fromBank });
		if (outcome === 'unknown-scope') {
			return fail(400, {
				edit: true,
				errors: { scope: 'Diese Zuordnung gibt es nicht.' },
				values: result.values
			});
		}
		redirect(303, `/auswertung/ausgaben?jahr=${result.data.date.slice(0, 4)}`);
	},
	delete: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		const outcome = await deleteExpense(locals.db, auditContext(locals), id);
		if (outcome === 'missing') return fail(404, { message: missing });
		if (outcome === 'from-bank') return fail(400, { message: fromBank });
		redirect(303, '/auswertung/ausgaben');
	}
};
