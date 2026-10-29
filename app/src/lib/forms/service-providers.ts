import type { ServiceProviderInput } from '../server/service-providers';
import { FormParser, type FieldErrors, type ParseResult } from './fields';

// Parses the form of a Dienstleister: a name, the rest optional.

export type ServiceProviderFormErrors = FieldErrors<ServiceProviderInput>;

export function parseServiceProvider(form: FormData): ParseResult<ServiceProviderInput> {
	const parser = new FormParser<ServiceProviderInput>(form);
	const name = parser.text('name', { max: 120 });
	const service = parser.optionalText('service', 80);
	const phone = parser.optionalText('phone', 40);
	const email = parser.raw('email') ? parser.email('email') : null;
	const note = parser.optionalText('note', 2000);
	return parser.result(() => ({ name, service, phone, email, note }));
}
