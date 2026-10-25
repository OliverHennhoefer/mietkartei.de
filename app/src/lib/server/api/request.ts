import { isHttpError } from '@sveltejs/kit';
import { authenticateApiKey, type ApiCaller } from '../api-keys';
import { apiReadOnly } from '../billing';
import type { Database } from '../db';
import { isForeignKeyError } from '../db/errors';
import { getApiLimiter } from '../rate-limit';
import { InputError, parseInput } from './input';
import { ApiError, permits, toJson, type Operation } from './operations';

// What the REST routes and the MCP server share around an operation: the key from the
// Authorization header, the rate limit, the scope and the read-only state of the account.
// Session cookies are never looked at here, so a page on another site cannot make a signed-in
// browser call the API.

/** The key of `Authorization: Bearer mk_…`, or undefined. */
function bearerToken(request: Request): string | undefined {
	const header = request.headers.get('authorization');
	const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
	return match?.[1];
}

/**
 * The caller behind the request's key. A missing or wrong key is counted against the client
 * address, a valid one against the key, so neither guessing keys nor a runaway script gets far.
 */
export async function authenticateRequest(
	db: Database,
	request: Request,
	clientAddress: string
): Promise<ApiCaller> {
	const limiter = await getApiLimiter();
	const token = bearerToken(request);
	const caller = token ? await authenticateApiKey(db, token) : undefined;
	if (!caller) {
		if (!(await limiter.limit(`ip:${clientAddress}`))) throw tooManyRequests();
		throw new ApiError(
			401,
			'unauthorized',
			token
				? 'The API key is unknown, expired or revoked.'
				: 'Send an API key as "Authorization: Bearer mk_…". Keys are created under Einstellungen → KI-Assistenten.'
		);
	}
	if (!(await limiter.limit(`key:${caller.keyId}`))) throw tooManyRequests();
	return caller;
}

function tooManyRequests() {
	return new ApiError(429, 'rate_limited', 'Too many requests. Please wait a minute.');
}

/** Runs the operation for the caller and returns its result as JSON. */
export async function runOperation(
	db: Database,
	caller: ApiCaller,
	operation: Operation,
	rawInput: unknown,
	fromText = false
): Promise<unknown> {
	if (!permits(caller, operation)) {
		throw new ApiError(403, 'forbidden', 'This API key may only read.');
	}
	if (!operation.readOnly && (await apiReadOnly(db, caller.user.accountId))) {
		throw new ApiError(
			403,
			'read_only',
			'The account is read-only until a subscription is taken out.'
		);
	}
	let input;
	try {
		input = parseInput(rawInput, operation.input, fromText);
	} catch (error) {
		if (error instanceof InputError) throw new ApiError(400, 'invalid_input', error.message);
		throw error;
	}
	try {
		return toJson(await operation.run({ db, caller }, input));
	} catch (error) {
		// Thrown by the functions the pages share, e.g. a quota that is reached.
		if (isHttpError(error)) throw new ApiError(error.status, 'refused', error.body.message);
		if (isForeignKeyError(error)) {
			throw new ApiError(
				409,
				'conflict',
				'A record this change refers to was changed or deleted in the meantime. Load it again and retry.'
			);
		}
		throw error;
	}
}

/** The JSON answer for a failed call, with the headers its status calls for. */
export function errorResponse(error: ApiError): Response {
	const headers = new Headers({ 'content-type': 'application/json' });
	if (error.status === 401) headers.set('www-authenticate', 'Bearer realm="mietkartei"');
	if (error.status === 429) headers.set('retry-after', '60');
	return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
		status: error.status,
		headers
	});
}

/** Request bodies of the API are small JSON objects; anything larger is refused unread. */
const MAX_BODY_BYTES = 64 * 1024;

/** The parsed JSON body; throws ApiError for one that is too large or not JSON. */
export async function readJsonBody(request: Request): Promise<unknown> {
	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > MAX_BODY_BYTES) throw bodyTooLarge();
	// Read in chunks, so a body sent without a length is cut off at the limit as well.
	const chunks: Uint8Array[] = [];
	let size = 0;
	if (request.body) {
		const reader = request.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > MAX_BODY_BYTES) {
				await reader.cancel();
				throw bodyTooLarge();
			}
			chunks.push(value);
		}
	}
	const text = await new Blob(chunks as Uint8Array<ArrayBuffer>[]).text();
	if (!text.trim()) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		throw new ApiError(400, 'invalid_json', 'The body is not valid JSON.');
	}
}

function bodyTooLarge() {
	return new ApiError(413, 'too_large', `The body may have at most ${MAX_BODY_BYTES} bytes.`);
}
