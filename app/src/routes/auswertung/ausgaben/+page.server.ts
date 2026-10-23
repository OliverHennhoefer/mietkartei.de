import { fail } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { parseExpense } from '#lib/forms/expenses.ts';
import {
	createExpense,
	deleteExpense,
	firstExpenseYear,
	listExpenses,
	scopeOptions
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
	const [expenses, scopes, firstYear] = await Promise.all([
		listExpenses(locals.db, accountId, { from: `${year}-01-01`, to: `${year}-12-31` }),
		scopeOptions(locals.db, accountId),
		firstExpenseYear(locals.db, accountId)
	]);
	// The last six years, and back to the earliest expense, so every expense can be reached.
	const oldest = Math.min(currentYear - 5, firstYear ?? currentYear, year);
	const years: number[] = [];
	for (let candidate = Math.max(currentYear, year); candidate >= oldest; candidate--) {
		years.push(candidate);
	}
	return { year, years, today: date, expenses, scopes };
};

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
	delete: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		const outcome = await deleteExpense(locals.db, auditContext(locals), id);
		if (outcome === 'missing') return fail(404, { message: 'Diese Ausgabe gibt es nicht.' });
		if (outcome === 'from-bank') {
			return fail(400, {
				message: 'Diese Ausgabe stammt aus einem Bankumsatz; hebe die Zuordnung unter Bank auf.'
			});
		}
		return { deleted: id };
	}
};
