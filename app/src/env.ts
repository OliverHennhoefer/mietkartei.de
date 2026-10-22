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
	TURNSTILE_SITE_KEY: {
		description:
			'Site key of a Cloudflare Turnstile widget. Together with TURNSTILE_SECRET_KEY it puts the ' +
			'bot check on the registration form; unset, the form has none. The hosted variant sets both.',
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
	STRIPE_SECRET_KEY: {
		description:
			'Stripe secret key (sk_test_… in test mode). Together with STRIPE_PRICE_ID it turns on the ' +
			'subscription of the hosted variant; unset, a self-hosted instance shows nothing of it. ' +
			'A secret on the hosted variant.',
		schema: (value) => value || ''
	},
	STRIPE_PRICE_ID: {
		description: 'Stripe price of the monthly subscription (price_…).',
		schema: (value) => value || ''
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
	E2E: {
		description:
			'"true" enables the /api/e2e routes the end-to-end tests use to seed data and read the ' +
			'mail outbox. Never set it elsewhere.',
		schema: (value) => value === 'true'
	}
});
