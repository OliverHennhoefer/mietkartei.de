import { fail } from '@sveltejs/kit';
import { parseApiKey } from '#lib/forms/api-keys.ts';
import { operations } from '#lib/server/api/operations.ts';
import {
	API_KEY_LIFETIMES,
	createApiKey,
	DEFAULT_API_KEY_LIFETIME,
	listApiKeys,
	MAX_API_KEYS_PER_USER,
	revokeApiKey
} from '#lib/server/api-keys.ts';
import type { ApiKeyScope } from '#lib/server/db/schema.ts';
import { auditContext } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// The API keys of the signed-in user: create one for the API or an assistant (MCP), see the ones
// that exist, revoke them. Every user manages their own keys; a key has the rights of its user.

/** Write keys are offered only once there is something to write. */
const scopes: ApiKeyScope[] = operations.some((operation) => operation.scope === 'write')
	? ['read', 'write']
	: ['read'];

export const load: PageServerLoad = async ({ locals, url }) => {
	return {
		keys: await listApiKeys(locals.db, auditContext(locals)),
		scopes,
		lifetimes: API_KEY_LIFETIMES,
		defaultLifetime: DEFAULT_API_KEY_LIFETIME,
		origin: url.origin
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const result = parseApiKey(await request.formData(), scopes);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const created = await createApiKey(locals.db, auditContext(locals), result.data);
		if (!created.ok) {
			return fail(400, {
				refused: `Du hast schon ${MAX_API_KEYS_PER_USER} API-Schlüssel. Widerrufe einen, um einen neuen anzulegen.`
			});
		}
		// The only time the key leaves the server; the database holds its hash.
		return { created: { name: result.data.name, key: created.key } };
	},

	revoke: async ({ request, locals }) => {
		const id = (await request.formData()).get('keyId');
		if (typeof id !== 'string' || !(await revokeApiKey(locals.db, auditContext(locals), id))) {
			return fail(404, { refused: 'Diesen API-Schlüssel gibt es nicht mehr.' });
		}
		return { revoked: true };
	}
};
