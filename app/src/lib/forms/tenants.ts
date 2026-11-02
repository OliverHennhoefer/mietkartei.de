import type { TenantInput } from '../server/tenants';
import { normalizePostalCode, normalizeStreet, singleLine } from '../domain/address';
import { FormParser, type ParseResult } from './fields';

// Parses the tenant form. The CSV import builds one FormData per row and uses the same parser,
// so a tenant from a file is checked exactly like one typed in.
//
// The form asks for an address only when the tenant gets letters elsewhere: it sends
// `addressChoice` with the switch `separateAddress`. Without the switch the tenant lives in the
// rented unit, the address stays empty and letters go to the property of the lease; with it,
// street, postal code and city are all needed. The import sends neither and keeps its columns.

export function parseTenant(form: FormData): ParseResult<TenantInput> {
	const parser = new FormParser<TenantInput>(form);
	const salutation = parser.optionalText('salutation', 50);
	const firstName = parser.text('firstName', { max: 100 });
	const lastName = parser.text('lastName', { max: 100 });
	const email = parser.raw('email') ? parser.email('email') : null;
	const phone = parser.optionalText('phone', 50);
	const chosen = form.has('addressChoice');
	const separate = !chosen || parser.flag('separateAddress');
	const required = chosen && separate;
	let street: string | null = null;
	let postalCode: string | null = null;
	let city: string | null = null;
	if (separate) {
		street = normalizeStreet(parser.text('street', { required })) || null;
		postalCode = normalizePostalCode(parser.raw('postalCode')) || null;
		if (postalCode && !/^\d{5}$/.test(postalCode)) {
			parser.fail('postalCode', 'Die Postleitzahl hat fünf Ziffern.');
		} else if (!postalCode && required) {
			parser.fail('postalCode', 'Bitte fülle dieses Feld aus.');
		}
		city = singleLine(parser.text('city', { required })) || null;
	}
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
