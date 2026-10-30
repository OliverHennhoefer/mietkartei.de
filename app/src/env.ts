import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_PATH: {
		description: 'Path of the SQLite database file. Only used by the node target.',
		schema: (value) => value || './data/mietkartei.db'
	},
	DATA_DIR: {
		description:
			'Directory for uploaded documents. Only used by the node target. Defaults to a ' +
			'"documents" directory next to the database file, so one volume holds both.',
		schema: (value) => value || ''
	},
	REGISTRATION_EMAILS: {
		description:
			'Email addresses that may register, separated by commas. Set, only they can, each through ' +
			'a link mailed to it. Unset, a ' +
			'self-hosted instance lets only the first person register, who takes over the existing ' +
			'data, and the hosted variant lets nobody. Keep it a secret on the hosted variant.',
		schema: (value) => value || ''
	},
	SETUP_CODE: {
		description:
			'A code the first person must enter to register on an instance without REGISTRATION_EMAILS, ' +
			'so nobody else can take over a fresh instance that is already public, such as one on ' +
			'workers.dev. Unset, the first person registers without one. A secret.',
		schema: (value) => value || ''
	},
	HOSTED: {
		description:
			'"true" only on app.mietkartei.de and its demo: without REGISTRATION_EMAILS nobody may ' +
			'register, not even into an empty database, and the app announces its launch. Self-hosted ' +
			'instances, also on Cloudflare, leave it unset.',
		schema: (value) => value === 'true'
	},
	TURNSTILE_SITE_KEY: {
		description:
			'Site key of a Cloudflare Turnstile widget. Together with TURNSTILE_SECRET_KEY it puts the ' +
			"bot check on the registration form and the demo's start; unset, they have none. The " +
			'hosted variant sets both.',
		schema: (value) => value || ''
	},
	TURNSTILE_SECRET_KEY: {
		description: 'Secret key of the Turnstile widget, for the server-side check of its token.',
		schema: (value) => value || ''
	},
	ORIGIN: {
		description:
			'Public URL of the app, e.g. "https://mietkartei.example.de". On node server.js derives ' +
			'the request origin from it; password reset mails need it unless the app is opened at localhost.',
		schema: (value) => value || ''
	},
	MAIL_TRANSPORT: {
		description:
			'How mails (password reset, invitations, address confirmation) are sent: "console" ' +
			'(default) logs them, which the cloudflare target refuses, "resend" uses the Resend HTTP ' +
			'API with MAIL_API_KEY and MAIL_FROM, "outbox" stores them in the database for tests.',
		schema: (value) => {
			if (!value) return 'console' as const;
			if (value === 'console' || value === 'resend' || value === 'outbox') return value;
			throw new Error('MAIL_TRANSPORT is "console", "resend" or "outbox"');
		}
	},
	MAIL_API_KEY: {
		description:
			'API key of the mail provider, for MAIL_TRANSPORT=resend. A secret on the hosted variant.',
		schema: (value) => value || ''
	},
	MAIL_FROM: {
		description: 'Sender address, e.g. "mietkartei <noreply@mietkartei.de>".',
		schema: (value) => value || 'mietkartei <noreply@mietkartei.de>'
	},
	GENESIS_API_TOKEN: {
		description:
			'API token of a GENESIS-Online account of Destatis (free registration at ' +
			'genesis.destatis.de). Set, the app fetches the Verbraucherpreisindex for index rents ' +
			'from Destatis; unset, it has no VPI values. A secret on the hosted variant.',
		schema: (value) => value || ''
	},
	MAP_TILES_PATH: {
		description:
			'Path of a PMTiles archive with vector tiles of OpenStreetMap in the Protomaps schema, e.g. ' +
			'an extract of Germany (see docs/selbst-hosten.md). Set, the property list shows each ' +
			'property on a small street map; unset, on an outline map of Germany. Only used by the node ' +
			'target; the cloudflare target reads the map from the R2 bucket MAP.',
		schema: (value) => value || ''
	},
	GEOCODER_URL: {
		description:
			'Search endpoint of a Nominatim server that turns property addresses into map positions, ' +
			'asked once per address when it is saved. Defaults to the public server of OpenStreetMap; ' +
			'"off" asks none and places properties by their postal code.',
		schema: (value) => value || 'https://nominatim.openstreetmap.org/search'
	},
	STRIPE_SECRET_KEY: {
		description:
			'Stripe secret key (sk_test_… in test mode). Together with STRIPE_PRICE_ID it turns on the ' +
			'subscription of the hosted variant; unset, a self-hosted instance shows nothing of it. ' +
			'A secret on the hosted variant.',
		schema: (value) => value || ''
	},
	STRIPE_PRICE_ID: {
		description: 'Stripe price of the monthly subscription at the regular price (price_…).',
		schema: (value) => value || ''
	},
	STRIPE_YEARLY_PRICE_ID: {
		description:
			'Stripe price of the yearly subscription (price_…). Unset, only the monthly one is offered.',
		schema: (value) => value || ''
	},
	ENABLE_BANKING_APP_ID: {
		description:
			'Application id at Enable Banking (enablebanking.com). Together with ' +
			'ENABLE_BANKING_PRIVATE_KEY it turns on the Bankabruf, which fetches the transactions of ' +
			'a bank account instead of a file import; unset, there is none.',
		schema: (value) => value || ''
	},
	ENABLE_BANKING_PRIVATE_KEY: {
		description:
			'The private key of that application as PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----"); ' +
			'line breaks may be written as \\n. A secret.',
		schema: (value) => value || ''
	},
	ENABLE_BANKING_API_BASE: {
		description: 'Base URL of the Enable Banking API; the tests point it at a fake.',
		schema: (value) => value || 'https://api.enablebanking.com'
	},
	STRIPE_WEBHOOK_SECRET: {
		description:
			'Signing secret of the Stripe webhook endpoint /api/webhooks/stripe (whsec_…). A secret ' +
			'on the hosted variant.',
		schema: (value) => value || ''
	},
	STRIPE_API_BASE: {
		description: 'Base URL of the Stripe API; the end-to-end tests point it at a fake server.',
		schema: (value) => value || 'https://api.stripe.com'
	},
	BILLING_REQUIRED: {
		description:
			'"true": once the 30-day trial has ended, accounts without an active subscription can ' +
			'only read. Only with the Stripe keys.',
		schema: (value) => value === 'true'
	},
	FREE_ACCOUNT_EMAILS: {
		description:
			'Email addresses whose accounts never pay, separated by commas: an account whose owner has ' +
			'one of them is free, with no trial, notice or read-only state. A secret on the hosted variant.',
		schema: (value) => value || ''
	},
	TRIAL_FINGERPRINT_KEY: {
		description:
			'Secret key for the fingerprints of addresses that had a free trial, so an address gets only ' +
			'one trial, even after its account was deleted. Unset, every new account gets a trial. A ' +
			'long random string, a secret on the hosted variant.',
		schema: (value) => value || ''
	},
	DEMO: {
		description:
			'"true" makes the instance the public demo: every visitor starts an account of their own ' +
			'with the demo data at /demo, signed in without a password, deleted after 24 hours. Only ' +
			'for demo.mietkartei.de.',
		schema: (value) => value === 'true'
	},
	E2E: {
		description:
			'"true" enables the /api/e2e routes the end-to-end tests use to seed data and read the ' +
			'mail outbox. Never set it elsewhere.',
		schema: (value) => value === 'true'
	}
});
