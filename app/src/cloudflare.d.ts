// Bindings from wrangler.jsonc and the request helpers of the runtime, on the cloudflare target only.
declare module 'cloudflare:workers' {
	import type { D1Database, R2Bucket, RateLimit } from '@cloudflare/workers-types';

	export const env: {
		DB?: D1Database;
		DOCUMENTS?: R2Bucket;
		AUTH_LIMITER?: RateLimit;
	};

	/** Keeps the request's work alive until the promise settles, after the response is sent. */
	export function waitUntil(promise: Promise<unknown>): void;
}
