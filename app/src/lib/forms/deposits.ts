import { depositTransactionKinds } from '../server/db/schema';
import type { DepositMovementInput } from '../server/deposits';
import { FormParser, type ParseResult } from './fields';

// Parses the form of the Kaution tab. The lease comes from the route, never from the form.

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
