// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { SessionUser } from '#lib/server/auth.ts';
import type { Database } from '#lib/server/db/index.ts';

declare global {
	/** Set by vite.config.ts from the DEPLOY_TARGET environment variable. */
	const __DEPLOY_TARGET__: 'node' | 'cloudflare';
	/** Set by vite.config.ts from the version in package.json. */
	const __APP_VERSION__: string;

	interface Window {
		/** Cloudflare Turnstile, loaded by the registration page when the bot check is on. */
		turnstile?: { reset(widget?: string): void };
	}

	namespace App {
		// interface Error {}
		interface Locals {
			db: Database;
			/** Set for signed-in requests; the hook redirects everything else to the sign-in page. */
			user: SessionUser | undefined;
			/** An origin outside the app a form on the page redirects to, see allowFormRedirect. */
			formRedirectOrigin?: string;
		}
		// interface PageData {}
		interface PageState {
			/** A settings section opened as a dialog over the current page (shallow routing). */
			settings?: { href: string; data: Record<string, unknown> };
		}
		// interface Platform {}
	}
}

export {};
