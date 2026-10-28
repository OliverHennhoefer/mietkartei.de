import { MAX_DEDUCTIONS, type Deduction, type SettlementInput } from '../domain/deposit-settlement';
import { depositTransactionKinds } from '../server/db/schema';
import type { DepositMovementInput } from '../server/deposits';
import { FormParser, type ParseResult } from './fields';

// Parses the forms of the Kaution tab. The lease comes from the route, never from the form.

export type DepositMovementFormInput = Omit<DepositMovementInput, 'leaseId'>;

export function parseDepositMovement(form: FormData): ParseResult<DepositMovementFormInput> {
	const parser = new FormParser<DepositMovementFormInput>(form);
	const date = parser.date('date');
	const kind = parser.oneOf('kind', depositTransactionKinds);
	const amount = parser.money('amount');
	if (amount === 0) parser.fail('amount', 'Bitte gib einen Betrag über 0 € an.');
	const note = parser.optionalText('note', 500);
	return parser.result(() => ({ date: date!, kind: kind!, amount: amount!, note }));
}

/** The settlement form: date, interest, a row per Einbehalt (label1/amount1, …) and the offset. */
export type SettlementFields = SettlementInput & {
	[row: `label${number}`]: string;
	[row: `amount${number}`]: string;
};

export function parseSettlement(form: FormData): ParseResult<SettlementFields> {
	const parser = new FormParser<SettlementFields>(form);
	const date = parser.date('date');
	const interest = parser.money('interest', { required: false });
	const deductions: Deduction[] = [];
	for (let row = 1; row <= MAX_DEDUCTIONS; row++) {
		const label = parser.text(`label${row}`, { required: false, max: 200 });
		const amount = parser.money(`amount${row}`, { required: false });
		if (amount && !label) parser.fail(`label${row}`, 'Bitte gib den Grund des Einbehalts an.');
		else if (label && !amount) parser.fail(`amount${row}`, 'Bitte gib einen Betrag über 0 € an.');
		else if (label && amount) deductions.push({ label, amount });
	}
	const offsetArrears = parser.flag('offsetArrears');
	// A hidden field in cents; a malformed one counts as not shown.
	const shown = Number(parser.raw('shownArrears') || Number.NaN);
	return parser.result(() => ({
		date: date!,
		interest: interest ?? 0,
		deductions,
		offsetArrears,
		...(Number.isSafeInteger(shown) ? { shownArrears: shown } : {})
	}));
}
