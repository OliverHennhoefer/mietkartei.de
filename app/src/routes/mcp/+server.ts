import { json } from '@sveltejs/kit';
import { handleMessage, PARSE_ERROR } from '#lib/server/api/mcp.ts';
import { ApiError } from '#lib/server/api/operations.ts';
import { authenticateRequest, errorResponse, readJsonBody } from '#lib/server/api/request.ts';
import type { RequestHandler } from './$types';

// The MCP server for assistants such as Claude: POST JSON-RPC messages here with an API key as
// bearer token. Stateless, see #lib/server/api/mcp.ts; there is no event stream to GET.

export const POST: RequestHandler = async ({ request, url, locals, getClientAddress }) => {
	try {
		// Browsers send an Origin; one of another site is refused, as the MCP specification asks
		// against DNS rebinding. Assistants and scripts send none.
		const origin = request.headers.get('origin');
		if (origin && origin !== url.origin) {
			throw new ApiError(403, 'forbidden_origin', 'Requests from other origins are refused.');
		}
		const caller = await authenticateRequest(locals.db, request, getClientAddress());
		let message: unknown;
		try {
			message = await readJsonBody(request);
		} catch (error) {
			if (error instanceof ApiError && error.code === 'invalid_json') {
				return json(
					{ jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: error.message } },
					{ status: 400 }
				);
			}
			throw error;
		}
		const response = await handleMessage(locals.db, caller, message);
		if (!response) return new Response(null, { status: 202 });
		return json(response);
	} catch (error) {
		if (error instanceof ApiError) return errorResponse(error);
		throw error;
	}
};

const noStream: RequestHandler = () =>
	new Response(null, { status: 405, headers: { allow: 'POST' } });

export const GET = noStream;
export const DELETE = noStream;
