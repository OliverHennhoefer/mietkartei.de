import { json } from '@sveltejs/kit';
import { OAuthError, registerClient } from '#lib/server/oauth.ts';
import { ApiError } from '#lib/server/api/operations.ts';
import { readJsonBody } from '#lib/server/api/request.ts';
import { getApiLimiter } from '#lib/server/rate-limit/index.ts';
import type { RequestHandler } from './$types';

// Dynamic client registration (RFC 7591): an app such as the claude.ai connector registers itself
// before it sends the user to /oauth/authorize. Open to anyone, so counted per client address.

const cors = { 'access-control-allow-origin': '*' };

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const limiter = await getApiLimiter();
	if (!(await limiter.limit(`oauth:${getClientAddress()}`))) {
		return json(
			{ error: 'slow_down', error_description: 'Too many requests. Please wait a minute.' },
			{ status: 429, headers: { ...cors, 'retry-after': '60' } }
		);
	}
	try {
		const registration = await registerClient(locals.db, await readJsonBody(request));
		return json(registration, { status: 201, headers: cors });
	} catch (error) {
		if (error instanceof OAuthError) {
			return json(
				{ error: error.code, error_description: error.message },
				{ status: error.status, headers: cors }
			);
		}
		if (error instanceof ApiError) {
			return json(
				{ error: 'invalid_client_metadata', error_description: error.message },
				{ status: error.status, headers: cors }
			);
		}
		throw error;
	}
};

export const OPTIONS: RequestHandler = () =>
	new Response(null, {
		status: 204,
		headers: {
			...cors,
			'access-control-allow-methods': 'POST',
			'access-control-allow-headers': 'content-type'
		}
	});
