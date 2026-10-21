import type { TenantInput } from '../server/tenants';
import { FormParser, type ParseResult } from './fields';

// Parses the tenant form. The CSV import builds one FormData per row and uses the same parser,
// so a tenant from a file is checked exactly like one typed in.

export function parseTenant(form: FormData): ParseResult<TenantInput> {
	const parser = new FormParser<TenantInput>(form);
	const salutation = parser.optionalText('salutation', 50);
	const firstName = parser.text('firstName', { max: 100 });
	const lastName = parser.text('lastName', { max: 100 });
	const email = parser.raw('email') ? parser.email('email') : null;
	const phone = parser.optionalText('phone', 50);
	const street = parser.optionalText('street');
	const postalCode = parser.raw('postalCode') || null;
	if (postalCode && !/^\d{5}$/.test(postalCode)) {
		parser.fail('postalCode', 'Die Postleitzahl hat fünf Ziffern.');
	}
	const city = parser.optionalText('city');
	const notes = parser.optionalText('notes', 2000);

	return parser.result(() => ({
		salutation,
		firstName,
		lastName,
		email,
		phone,
		street,
		postalCode,
		city,
		notes
	}));
}
