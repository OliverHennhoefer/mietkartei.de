import { expenseCategories, type ExpenseCategory } from '../server/db/schema';
import { EXPENSE_SPLITS, type ExpenseSplit } from '../expense-splits';
import { FormParser, type FieldErrors } from './fields';

export type { ExpenseSplit };

// Parsers of the expense forms: a manual expense and the assignment of a bank transaction as an
// expense. Where the expense belongs is one select over properties and units, so its value
// carries the kind: `property:<id>`, `unit:<id>`, or '' for the portfolio as a whole. The
// Dienstleister is optional, '' for unknown. Whether the ids belong to the account is checked by
// the server module, not here.

/** Where an expense belongs; the server module fills in the property of a unit. */
export type ExpenseScope = { kind: 'portfolio' } | { kind: 'property' | 'unit'; id: string };

export type ExpenseAssignmentInput = {
	category: ExpenseCategory;
	scope: ExpenseScope;
	description: string;
	/** Who was paid; null when unknown. Left out (the API), a change keeps the Dienstleister. */
	serviceProviderId?: string | null;
	/** The Gegenkonto of kind expense; null without one. */
	contraAccountId?: string | null;
	/**
	 * Further parts of a bank transaction split over several accounts (Hausgeld: umlagefähig,
	 * nicht umlagefähig, Rücklage; Darlehensrate: Zins and Tilgung). Cents, positive; the first
	 * part keeps the rest.
	 */
	splits?: ExpenseSplit[];
};

export type ExpenseInput = ExpenseAssignmentInput & {
	date: string;
	/** Cents paid out, always positive for a manual expense. */
	amount: number;
};

export type ExpenseFields = {
	date: string;
	amount: string;
	category: string;
	scope: string;
	description: string;
	serviceProviderId: string;
	contraAccountId: string;
	[split: `split${number}Target` | `split${number}Amount`]: string;
};

export type ExpenseParseResult<T> =
	| { ok: true; data: T; values: Record<string, string> }
	| { ok: false; errors: FieldErrors<ExpenseFields>; values: Record<string, string> };

export const scopeValue = (kind: 'property' | 'unit', id: string) => `${kind}:${id}`;

function parseScope(parser: FormParser<ExpenseFields>): ExpenseScope {
	const value = parser.raw('scope');
	if (!value) return { kind: 'portfolio' };
	const match = /^(property|unit):([\w-]{1,64})$/.exec(value);
	if (!match) {
		parser.fail('scope', 'Bitte wähle einen gültigen Eintrag aus.');
		return { kind: 'portfolio' };
	}
	return { kind: match[1] as 'property' | 'unit', id: match[2] };
}

function parseServiceProvider(parser: FormParser<ExpenseFields>): string | null {
	const value = parser.raw('serviceProviderId');
	if (value && !/^[\w-]{1,64}$/.test(value)) {
		parser.fail('serviceProviderId', 'Bitte wähle einen gültigen Eintrag aus.');
	}
	return value || null;
}

/**
 * The assignment of a bank transaction as an expense. With a Gegenkonto the category may be left
 * empty (null): the server takes the Gegenkonto's.
 */
export function parseExpenseAssignment(
	form: FormData
): ExpenseParseResult<
	Omit<ExpenseAssignmentInput, 'category'> & { category: ExpenseCategory | null }
> {
	const parser = new FormParser<ExpenseFields>(form);
	const contraAccountId = parser.id('contraAccountId', { required: false });
	const category = parser.oneOf('category', expenseCategories, { required: !contraAccountId });
	const scope = parseScope(parser);
	const description = parser.text('description', { max: 200 });
	const serviceProviderId = parseServiceProvider(parser);
	const splits = parseSplits(parser);
	if (parser.hasErrors) return { ok: false, errors: parser.errors, values: parser.values };
	return {
		ok: true,
		data: { category, scope, description, serviceProviderId, contraAccountId, splits },
		values: parser.values
	};
}

/** The further parts: a row counts once it has an account; it then needs an amount. */
function parseSplits(parser: FormParser<ExpenseFields>): ExpenseSplit[] {
	const splits: ExpenseSplit[] = [];
	for (let index = 1; index <= EXPENSE_SPLITS; index += 1) {
		const target = parser.raw(`split${index}Target`);
		const amountField = `split${index}Amount` as const;
		if (!target) {
			parser.raw(amountField);
			continue;
		}
		const amount = parser.money(amountField, { min: 1 });
		const contra = /^contra:([\w-]{1,64})$/.exec(target);
		const category = /^category:(\w+)$/.exec(target)?.[1];
		if (amount === null) continue;
		if (contra) splits.push({ amount, contraAccountId: contra[1] });
		else if (category && (expenseCategories as readonly string[]).includes(category)) {
			splits.push({ amount, category: category as ExpenseCategory });
		} else parser.fail(`split${index}Target`, 'Bitte wähle einen gültigen Eintrag aus.');
	}
	return splits;
}

export function parseExpense(form: FormData): ExpenseParseResult<ExpenseInput> {
	const parser = new FormParser<ExpenseFields>(form);
	const date = parser.date('date');
	const amount = parser.money('amount', { min: 1 });
	const category = parser.oneOf('category', expenseCategories);
	const scope = parseScope(parser);
	const description = parser.text('description', { max: 200 });
	const serviceProviderId = parseServiceProvider(parser);
	if (parser.hasErrors) return { ok: false, errors: parser.errors, values: parser.values };
	return {
		ok: true,
		data: {
			date: date!,
			amount: amount!,
			category: category!,
			scope,
			description,
			serviceProviderId
		},
		values: parser.values
	};
}
