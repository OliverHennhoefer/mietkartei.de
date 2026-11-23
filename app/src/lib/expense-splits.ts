import type { ExpenseCategory } from './server/db/schema';

// A bank transaction booked as several expenses (Hausgeld: umlagefähig, nicht umlagefähig,
// Rücklage; Darlehensrate: Zins and Tilgung). Shared by the form parser, the server module and the
// bank page, so it imports types only.

/** One further part: a Gegenkonto of kind expense or, without one, a category. */
export type ExpenseSplit = { amount: number } & (
	| { contraAccountId: string; category?: undefined }
	| { category: ExpenseCategory; contraAccountId?: undefined }
);

/** How many further parts the form offers. */
export const EXPENSE_SPLITS = 3;

/** The select value of a part's account: `contra:<id>` or `category:<category>`. */
export const splitTargetValue = (split: ExpenseSplit): string =>
	split.contraAccountId ? `contra:${split.contraAccountId}` : `category:${split.category}`;
