import { json } from '@sveltejs/kit';
import { ApiError, operations, type Operation } from '#lib/server/api/operations.ts';
import {
	authenticateRequest,
	errorResponse,
	readJsonBody,
	runOperation
} from '#lib/server/api/request.ts';
import type { RequestHandler } from './$types';

// The REST API: every operation of operations.ts at its path, e.g. GET /api/v1/leases?status=active
// or GET /api/v1/leases/<id>/ledger. Query and path parameters are the operation's input; a POST
// takes its input as a JSON body. GET /api/v1 lists the operations.

/** `/leases/{id}/ledger` as a pattern whose group is the id. */
function pattern(path: string): RegExp {
	return new RegExp(`^${path.replace('{id}', '([^/]+)')}$`);
}

const routes = operations.map((operation) => ({ operation, pattern: pattern(operation.path) }));

function match(method: string, path: string): { operation: Operation; id?: string } | undefined {
	for (const route of routes) {
		if (route.operation.method !== method) continue;
		const found = route.pattern.exec(path);
		if (found) return { operation: route.operation, id: found[1] && decodeURIComponent(found[1]) };
	}
	return undefined;
}

/** The operations as a table of contents, for people writing a client. */
function index() {
	return {
		operations: operations.map((operation) => ({
			method: operation.method,
			path: `/api/v1${operation.path}`,
			tool: operation.name,
			scope: operation.scope,
			description: operation.description,
			input: operation.input
		}))
	};
}

const handle: RequestHandler = async ({ request, params, url, locals, getClientAddress }) => {
	try {
		const caller = await authenticateRequest(locals.db, request, getClientAddress());
		const path = `/${params.path}`.replace(/\/$/, '');
		if (path === '' && request.method === 'GET') return json(index());
		const found = match(request.method, path);
		if (!found) {
			const known = routes.some((route) => route.pattern.test(path));
			throw known
				? new ApiError(405, 'method_not_allowed', `${request.method} is not allowed here.`)
				: new ApiError(404, 'not_found', `There is no operation at ${url.pathname}.`);
		}
		let input: Record<string, unknown>;
		let fromText: boolean;
		if (request.method === 'GET') {
			input = Object.fromEntries(url.searchParams);
			fromText = true;
		} else {
			const body = await readJsonBody(request);
			if (
				body !== undefined &&
				(typeof body !== 'object' || body === null || Array.isArray(body))
			) {
				throw new ApiError(400, 'invalid_input', 'The body must be a JSON object.');
			}
			input = { ...(body as Record<string, unknown> | undefined) };
			fromText = false;
		}
		if (found.id !== undefined) input.id = found.id;
		const data = await runOperation(locals.db, caller, found.operation, input, fromText);
		return json({ data });
	} catch (error) {
		if (error instanceof ApiError) return errorResponse(error);
		throw error;
	}
};

export const GET = handle;
export const POST = handle;
