import { json } from '@sveltejs/kit';
import { exchangeToken, OAuthError } from '#lib/server/oauth.ts';
import { getApiLimiter } from '#lib/server/rate-limit/index.ts';
import type { RequestHandler } from './$types';

// The token endpoint: an app exchanges the code from /oauth/authorize, or its refresh token, for
// tokens. Form-encoded as OAuth asks; the apps call it from their servers.

const noStore = { 'cache-control': 'no-store' };

function failure(code: string, message: string, status: number, headers = {}) {
	return json(
		{ error: code, error_description: message },
		{ status, headers: { ...noStore, ...headers } }
	);
}

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const limiter = await getApiLimiter();
	if (!(await limiter.limit(`oauth:${getClientAddress()}`))) {
		return failure('slow_down', 'Too many requests. Please wait a minute.', 429, {
			'retry-after': '60'
		});
	}
	let form: URLSearchParams;
	try {
		form = new URLSearchParams(await request.text());
	} catch {
		return failure('invalid_request', 'Expected a form-encoded body.', 400);
	}
	// Apps that registered without a secret may still send their id as Basic authentication.
	const basic = request.headers.get('authorization')?.match(/^Basic\s+(\S+)$/i)?.[1];
	if (basic && !form.has('client_id')) {
		try {
			form.set('client_id', decodeURIComponent(atob(basic).split(':')[0]));
		} catch {
			return failure('invalid_client', 'The Basic authentication is malformed.', 401);
		}
	}
	try {
		return json(await exchangeToken(locals.db, form), { headers: noStore });
	} catch (error) {
		if (error instanceof OAuthError) return failure(error.code, error.message, error.status);
		throw error;
	}
};
