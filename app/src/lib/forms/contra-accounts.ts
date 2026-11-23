import {
	contraAccountKinds,
	expenseCategories,
	otherBookingKinds,
	type ContraAccountKind,
	type ExpenseCategory,
	type OtherBookingKind
} from '../server/db/schema';
import { FormParser, type FieldErrors, type ParseResult } from './fields';

// Parsers of the Gegenkonto form and of booking a bank transaction as an other booking
// (Kapitalertrag, Privat, sonstige Einnahme). Whether the ids belong to the account is checked by
// the server module.

export type ContraAccountInput = {
	/** The landlord's own account number, e.g. „4401“; null without one. */
	number: string | null;
	name: string;
	kind: ContraAccountKind;
	/** Required for kind expense, null for the others. */
	expenseCategory: ExpenseCategory | null;
	propertyId: string | null;
};

export type ContraAccountFields = {
	number: string;
	name: string;
	kind: string;
	expenseCategory: string;
	propertyId: string;
};

export function parseContraAccount(form: FormData): ParseResult<ContraAccountInput> {
	const parser = new FormParser<ContraAccountFields>(form);
	const number = parser.optionalText('number', 20);
	const name = parser.text('name', { max: 100 });
	const kind = parser.oneOf('kind', contraAccountKinds);
	const category = parser.oneOf('expenseCategory', expenseCategories, { required: false });
	if (kind === 'expense' && !category) {
		parser.fail('expenseCategory', 'Bitte wähle die Kategorie der Ausgaben aus.');
	}
	const propertyId = parser.id('propertyId', { required: false });
	if (parser.hasErrors) return { ok: false, errors: parser.errors, values: parser.values };
	return {
		ok: true,
		data: {
			number,
			name,
			kind: kind!,
			expenseCategory: kind === 'expense' ? category : null,
			propertyId
		}
	};
}

export type OtherBookingInput = {
	/** Taken from the Gegenkonto when one is chosen. */
	kind: OtherBookingKind | null;
	contraAccountId: string | null;
	/** Null: the Gegenkonto's property, else none. */
	propertyId: string | null;
	description: string;
};

export type OtherBookingFields = {
	kind: string;
	contraAccountId: string;
	propertyId: string;
	description: string;
};

export type OtherBookingResult =
	| { ok: true; data: OtherBookingInput; values: Record<string, string> }
	| { ok: false; errors: FieldErrors<OtherBookingFields>; values: Record<string, string> };

export function parseOtherBooking(form: FormData): OtherBookingResult {
	const parser = new FormParser<OtherBookingFields>(form);
	const contraAccountId = parser.id('contraAccountId', { required: false });
	const kind = parser.oneOf('kind', otherBookingKinds, { required: !contraAccountId });
	const propertyId = parser.id('propertyId', { required: false });
	const description = parser.text('description', { required: false, max: 200 });
	if (parser.hasErrors) return { ok: false, errors: parser.errors, values: parser.values };
	return {
		ok: true,
		data: { kind, contraAccountId, propertyId, description },
		values: parser.values
	};
}
