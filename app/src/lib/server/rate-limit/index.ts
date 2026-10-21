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

let authLimiter: Promise<RateLimiter> | undefined;

export function getAuthLimiter(): Promise<RateLimiter> {
	authLimiter ??= (async () => {
		if (__DEPLOY_TARGET__ === 'cloudflare') {
			const { openCloudflareLimiter } = await import('./cloudflare');
			return openCloudflareLimiter();
		}
		const { createMemoryLimiter } = await import('./memory');
		return createMemoryLimiter(AUTH_LIMIT, AUTH_PERIOD_SECONDS * 1000);
	})();
	return authLimiter;
}
