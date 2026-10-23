// Limits how often one client may do something expensive or guessable, e.g. post the sign-in
// form. Cloudflare counts in its rate limiting binding, shared by all isolates of a location;
// the node server counts in memory, which is exact for its single process.

export interface RateLimiter {
	/** Counts one attempt for the key; false when the key is over its limit. */
	limit(key: string): Promise<boolean>;
}

/**
 * Posts of the sign-in, registration, reset and invitation forms per client address and minute.
 * A person who mistypes their password a few times stays well below it; a script guessing
 * passwords is slowed to a crawl.
 */
export const AUTH_LIMIT = 10;
export const AUTH_PERIOD_SECONDS = 60;

/**
 * Calls of the API and the MCP server per key and minute, and calls with a wrong key per client
 * address. An assistant working through a question makes a few dozen calls; a script copying the
 * database in a loop is held back.
 */
export const API_LIMIT = 120;
export const API_PERIOD_SECONDS = 60;

let authLimiter: Promise<RateLimiter> | undefined;
let apiLimiter: Promise<RateLimiter> | undefined;

async function openLimiter(
	binding: 'AUTH_LIMITER' | 'API_LIMITER',
	limit: number,
	periodSeconds: number
): Promise<RateLimiter> {
	if (__DEPLOY_TARGET__ === 'cloudflare') {
		const { openCloudflareLimiter } = await import('./cloudflare');
		return openCloudflareLimiter(binding);
	}
	const { createMemoryLimiter } = await import('./memory');
	return createMemoryLimiter(limit, periodSeconds * 1000);
}

export function getAuthLimiter(): Promise<RateLimiter> {
	authLimiter ??= openLimiter('AUTH_LIMITER', AUTH_LIMIT, AUTH_PERIOD_SECONDS);
	return authLimiter;
}

export function getApiLimiter(): Promise<RateLimiter> {
	apiLimiter ??= openLimiter('API_LIMITER', API_LIMIT, API_PERIOD_SECONDS);
	return apiLimiter;
}
