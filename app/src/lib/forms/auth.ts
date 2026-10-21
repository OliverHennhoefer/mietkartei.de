import type { LandlordInput } from '../server/accounts';
import { FormParser, type ParseResult } from './fields';

// Parsers of the account pages: the landlord sender block on the profile page.

/** The landlord sender block; every field is optional, but a given postal code has five digits. */
export function parseLandlord(form: FormData): ParseResult<LandlordInput> {
	const parser = new FormParser<LandlordInput>(form);
	const landlordName = parser.optionalText('landlordName', 200);
	const street = parser.optionalText('street', 200);
	const postalCode = parser.optionalText('postalCode', 10);
	if (postalCode && !/^\d{5}$/.test(postalCode)) {
		parser.fail('postalCode', 'Die Postleitzahl hat fünf Ziffern.');
	}
	const city = parser.optionalText('city', 200);
	return parser.result(() => ({ landlordName, street, postalCode, city }));
}
