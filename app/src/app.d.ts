// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { SessionUser } from '#lib/server/auth.ts';
import type { Database } from '#lib/server/db/index.ts';

declare global {
	/** Set by vite.config.ts from the DEPLOY_TARGET environment variable. */
	const __DEPLOY_TARGET__: 'node' | 'cloudflare';

	namespace App {
		// interface Error {}
		interface Locals {
			db: Database;
			/** Set for signed-in requests; the hook redirects everything else to the sign-in page. */
			user: SessionUser | undefined;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
