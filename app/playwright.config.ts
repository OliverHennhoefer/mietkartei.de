import { defineConfig } from '@playwright/test';

// The end-to-end tests run against a production build of either target, each with a fresh
// database: DEPLOY_TARGET=node (default) or DEPLOY_TARGET=cloudflare (workerd with a local D1).
const target = process.env.DEPLOY_TARGET === 'cloudflare' ? 'cloudflare' : 'node';
const port = Number(process.env.E2E_PORT || 4173);

// Mails go to the outbox table, where the tests read them through /__e2e/outbox.
const commands = {
	node: [
		'rm -rf .e2e',
		'npm run build',
		`DATABASE_PATH=.e2e/node.db DATA_DIR=.e2e/documents MAIL_TRANSPORT=outbox E2E=true PORT=${port} node server.js`
	],
	cloudflare: [
		'rm -rf .e2e',
		'npm run build:cloudflare',
		'wrangler d1 migrations apply DB --local --persist-to .e2e/wrangler',
		`wrangler dev --port ${port} --inspector-port 0 --persist-to .e2e/wrangler --var MAIL_TRANSPORT:outbox --var E2E:true`
	]
};

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	workers: 1,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: `http://localhost:${port}`,
		launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
			? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
			: {}
	},
	projects: [
		// Registers the first user of the fresh database; the other projects build on it.
		{ name: 'setup', testMatch: 'setup.e2e.ts' },
		{ name: 'signed out', testMatch: 'auth.e2e.ts', dependencies: ['setup'] },
		// Every feature's tests, as the owner. They seed what they do not own through e2e/seed.ts.
		{
			name: 'signed in',
			testMatch: /\.e2e\.ts$/,
			testIgnore: ['setup.e2e.ts', 'auth.e2e.ts', 'manager.e2e.ts', 'konto.e2e.ts'],
			dependencies: ['setup'],
			use: { storageState: '.e2e/owner.json' }
		},
		// The manager role: manager.e2e.ts invites and signs in a manager itself (storage state of its own).
		{ name: 'manager', testMatch: 'manager.e2e.ts', dependencies: ['signed in'] },
		// Deleting the account ends the run, so it depends on everything else.
		{
			name: 'account',
			testMatch: 'konto.e2e.ts',
			dependencies: ['signed in', 'manager', 'signed out'],
			use: { storageState: '.e2e/owner.json' }
		}
	],
	webServer: {
		command: commands[target].join(' && '),
		url: `http://localhost:${port}/health`,
		timeout: 180_000,
		reuseExistingServer: false
	}
});
