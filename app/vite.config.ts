import { coverageConfigDefaults, defineConfig } from 'vitest/config';
import cloudflare from '@sveltejs/adapter-cloudflare';
import node from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { readFileSync } from 'node:fs';

// The version shown at the bottom of the sidebar; set in package.json for each release.
const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));

// The same code builds for self-hosting (Node, one SQLite file) and for Cloudflare Workers (D1).
const target = process.env.DEPLOY_TARGET || 'node';
if (target !== 'node' && target !== 'cloudflare') {
	throw new Error('DEPLOY_TARGET must be "node" or "cloudflare"');
}

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: target === 'cloudflare' ? cloudflare() : node(),
			// The hook checks the origin of form posts instead, with an exception for the OAuth
			// token endpoint; see #lib/server/csrf.ts.
			csrf: { trustedOrigins: ['*'] },
			// Only the app's own scripts and styles run; SvelteKit adds a nonce to the inline ones it
			// renders. Nothing may frame the app, and forms only post to it.
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					// Cloudflare Turnstile, the bot check of the registration form, loads its script
					// from there and shows its challenge in a frame from there.
					'script-src': ['self', 'https://challenges.cloudflare.com'],
					'frame-src': ['https://challenges.cloudflare.com'],
					'style-src': ['self'],
					// SvelteKit's route announcer for screen readers is hidden with a style attribute.
					// Style attributes cannot run scripts; <style> elements still need the nonce.
					'style-src-attr': ['unsafe-inline'],
					'img-src': ['self', 'data:'],
					'font-src': ['self'],
					'connect-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['none'],
					// The subscription page's forms answer with a redirect to Stripe Checkout or the
					// Customer Portal, and the Bankabruf's with one to Enable Banking, which a browser
					// without JavaScript follows as part of the post.
					'form-action': [
						'self',
						'https://checkout.stripe.com',
						'https://billing.stripe.com',
						'https://*.enablebanking.com'
					],
					'frame-ancestors': ['none']
				}
			}
		})
	],
	define: {
		// Replaced at build time, so the bundle for one target never contains the other's driver.
		__DEPLOY_TARGET__: JSON.stringify(target),
		__APP_VERSION__: JSON.stringify(version)
	},
	server: {
		// The logo and favicon are shared with the website and docs in ../assets/brand.
		fs: { allow: ['../assets/brand'] }
	},
	test: {
		expect: { requireAssertions: true },
		// CI uploads the lcov report to Codecov; the e2e tests are not part of the coverage. The
		// unit tests never render a component, so the .svelte files are left out: their markup is
		// what the Playwright tests click through on both targets, and logic worth a unit test
		// belongs in a .ts module. Also left out: the unit test fixtures and the /api/e2e routes,
		// which exist only for the end-to-end tests.
		coverage: {
			provider: 'v8',
			include: ['src/**/*.{js,ts}'],
			exclude: [
				...coverageConfigDefaults.exclude,
				'src/**/*.d.ts',
				'src/lib/server/testing.ts',
				'src/routes/api/e2e/**'
			],
			reporter: ['text-summary', 'lcov']
		},
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}', 'src/**/*.cloudflare.spec.ts']
				}
			},
			{
				// The same modules built for the cloudflare target, to test which binding each one
				// picks there. Their coverage is merged with the node run.
				extends: './vite.config.ts',
				define: { __DEPLOY_TARGET__: JSON.stringify('cloudflare') },
				test: {
					name: 'cloudflare',
					environment: 'node',
					include: ['src/**/*.cloudflare.spec.ts']
				}
			}
		]
	}
});
