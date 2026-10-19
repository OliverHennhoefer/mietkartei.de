import { defineConfig } from 'vitest/config';
import cloudflare from '@sveltejs/adapter-cloudflare';
import node from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

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
			adapter: target === 'cloudflare' ? cloudflare() : node()
		})
	],
	define: {
		// Replaced at build time, so the bundle for one target never contains the other's driver.
		__DEPLOY_TARGET__: JSON.stringify(target)
	},
	server: {
		// The logo and favicon are shared with the website and docs in ../assets/brand.
		fs: { allow: ['../assets/brand'] }
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
