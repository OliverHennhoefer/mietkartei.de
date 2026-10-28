import type { ContractorInput } from '../server/contractors';
import { FormParser, type FieldErrors, type ParseResult } from './fields';

// Parses the form of a Handwerker: a name, the rest optional.

export type ContractorFormErrors = FieldErrors<ContractorInput>;

export function parseContractor(form: FormData): ParseResult<ContractorInput> {
	const parser = new FormParser<ContractorInput>(form);
	const name = parser.text('name', { max: 120 });
	const trade = parser.optionalText('trade', 80);
	const phone = parser.optionalText('phone', 40);
	const email = parser.raw('email') ? parser.email('email') : null;
	const note = parser.optionalText('note', 2000);
	return parser.result(() => ({ name, trade, phone, email, note }));
}
