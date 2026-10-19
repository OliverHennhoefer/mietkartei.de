import { defineConfig } from '@playwright/test';

// The end-to-end tests run against a production build of either target, each with a fresh
// database: DEPLOY_TARGET=node (default) or DEPLOY_TARGET=cloudflare (workerd with a local D1).
const target = process.env.DEPLOY_TARGET === 'cloudflare' ? 'cloudflare' : 'node';
const port = 4173;

const commands = {
	node: [
		'rm -rf .e2e',
		'npm run build',
		`DATABASE_PATH=.e2e/node.db ORIGIN=http://localhost:${port} PORT=${port} node server.js`
	],
	cloudflare: [
		'rm -rf .e2e',
		'npm run build:cloudflare',
		'wrangler d1 migrations apply DB --local --persist-to .e2e/wrangler',
		`wrangler dev --port ${port} --persist-to .e2e/wrangler`
	]
};

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	fullyParallel: false,
	workers: 1,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: `http://localhost:${port}`,
		launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
			? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
			: {}
	},
	webServer: {
		command: commands[target].join(' && '),
		url: `http://localhost:${port}/health`,
		timeout: 180_000,
		reuseExistingServer: false
	}
});
