import { API_KEY_LIFETIMES, type ApiKeyInput } from '../server/api-keys';
import type { ApiKeyScope } from '../server/db/schema';
import { FormParser, type ParseResult } from './fields';

// The form of /einstellungen/api-schluessel.

/** "Neuer API-Schlüssel"; `scopes` are the scopes the instance offers, the first one by default. */
export function parseApiKey(
	form: FormData,
	scopes: readonly ApiKeyScope[]
): ParseResult<ApiKeyInput> {
	const parser = new FormParser<ApiKeyInput>(form);
	const name = parser.text('name', { max: 100 });
	const scope = scopes.length > 1 ? parser.oneOf('scope', scopes) : scopes[0];
	const days = Number(parser.raw('lifetimeDays'));
	const lifetimeDays = API_KEY_LIFETIMES.find((allowed) => allowed === days);
	if (!lifetimeDays) parser.fail('lifetimeDays', 'Bitte wähle eine Gültigkeit aus.');
	return parser.result(() => ({ name, scope: scope!, lifetimeDays: lifetimeDays! }));
}
