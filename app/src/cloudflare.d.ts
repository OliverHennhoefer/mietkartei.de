// Bindings from wrangler.jsonc, available on the cloudflare target only.
declare module 'cloudflare:workers' {
	import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

	export const env: {
		DB?: D1Database;
		DOCUMENTS?: R2Bucket;
	};
}
