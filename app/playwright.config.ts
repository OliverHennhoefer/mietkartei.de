import { defineConfig } from '@playwright/test';

// The end-to-end tests run against a production build of either target, each with a fresh
// database: DEPLOY_TARGET=node (default) or DEPLOY_TARGET=cloudflare (workerd with a local D1).
const target = process.env.DEPLOY_TARGET === 'cloudflare' ? 'cloudflare' : 'node';
const port = Number(process.env.E2E_PORT || 4173);
// The Stripe fake of billing.e2e.ts; another port lets two checkouts run their suites side by side.
const stripePort = Number(process.env.STRIPE_FAKE_PORT || 4299);

// E2E=true enables /api/e2e/seed, through which the tests create what they do not own, and
// /api/e2e/outbox, where they read the mails MAIL_TRANSPORT=outbox stores instead of sending. The
// hosted variant lets only listed addresses register, so the owner of e2e/owner.ts is listed.
// wrangler dev hands the app the host of the route in wrangler.jsonc unless --local-upstream
// names another, and the links in mails must lead back to the test server.
//
// Sign-in, registration, reset and invitation posts are limited to 10 per client address and
// minute. Every request of a test comes from localhost, and on a fast runner the whole suite fits
// into one minute, so each project names a client address of its own in CF-Connecting-IP: the
// header Workers take the address from, and on node through ADDRESS_HEADER, as behind a proxy.
//
// The subscription runs against e2e/stripe-fake.ts, with test keys that only the fake accepts.
const commands = {
	node: [
		'rm -rf .e2e',
		'npm run build',
		`DATABASE_PATH=.e2e/node.db DATA_DIR=.e2e/documents MAIL_TRANSPORT=outbox E2E=true ADDRESS_HEADER=cf-connecting-ip STRIPE_SECRET_KEY=sk_test_fake STRIPE_PRICE_ID=price_fake STRIPE_WEBHOOK_SECRET=whsec_fake STRIPE_API_BASE=http://localhost:${stripePort} PORT=${port} node server.js`
	],
	cloudflare: [
		'rm -rf .e2e',
		'npm run build:cloudflare',
		'wrangler d1 migrations apply DB --local --persist-to .e2e/wrangler',
		`wrangler dev --port ${port} --local-upstream localhost:${port} --inspector-port 0 --persist-to .e2e/wrangler --var MAIL_TRANSPORT:outbox --var E2E:true --var REGISTRATION_EMAILS:vermieterin@example.org --var STRIPE_SECRET_KEY:sk_test_fake --var STRIPE_PRICE_ID:price_fake --var STRIPE_WEBHOOK_SECRET:whsec_fake --var STRIPE_API_BASE:http://localhost:${stripePort}`
	]
};

/** Request headers of a project whose posts count against the limit of the given address. */
function client(address: string) {
	return { extraHTTPHeaders: { 'cf-connecting-ip': address } };
}

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
		{ name: 'setup', testMatch: 'setup.e2e.ts', use: client('192.0.2.1') },
		{
			name: 'signed out',
			testMatch: 'auth.e2e.ts',
			dependencies: ['setup'],
			use: client('192.0.2.2')
		},
		// Every feature's tests, as the owner. They seed what they do not own through e2e/seed.ts.
		{
			name: 'signed in',
			testMatch: /\.e2e\.ts$/,
			testIgnore: [
				'setup.e2e.ts',
				'auth.e2e.ts',
				'manager.e2e.ts',
				'rate-limit.e2e.ts',
				'konto.e2e.ts'
			],
			dependencies: ['setup'],
			use: { storageState: '.e2e/owner.json', ...client('192.0.2.3') }
		},
		// The manager role: the owner invites a manager, who signs up in a browser of their own.
		{
			name: 'manager',
			testMatch: 'manager.e2e.ts',
			dependencies: ['signed in'],
			use: { storageState: '.e2e/owner.json', ...client('192.0.2.4') }
		},
		// Exhausts the sign-in limit of its client address. It has an address of its own, and runs
		// after the feature tests all the same, so a failure cannot leave other tests refused.
		{
			name: 'rate limit',
			testMatch: 'rate-limit.e2e.ts',
			dependencies: ['signed out', 'signed in', 'manager'],
			use: client('192.0.2.5')
		},
		// Deleting the account ends the run, so it depends on everything else.
		{
			name: 'account',
			testMatch: 'konto.e2e.ts',
			dependencies: ['signed out', 'signed in', 'manager', 'rate limit'],
			use: { storageState: '.e2e/owner.json', ...client('192.0.2.6') }
		}
	],
	webServer: {
		command: commands[target].join(' && '),
		url: `http://localhost:${port}/health`,
		timeout: 180_000,
		reuseExistingServer: false
	}
});
