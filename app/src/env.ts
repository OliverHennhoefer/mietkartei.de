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
	OPEN_REGISTRATION: {
		description:
			'"true" lets anyone register a new account. Otherwise only the first person can register, ' +
			'and that person takes over the existing data. The hosted variant sets it; self-hosting does not.',
		schema: (value) => value === 'true'
	},
	MAIL_TRANSPORT: {
		description:
			'How mails (password reset, invitations) are sent: "console" logs them, "resend" uses the ' +
			'Resend HTTP API with MAIL_API_KEY and MAIL_FROM, "outbox" stores them in the database for tests.',
		schema: (value) => {
			if (value === 'resend' || value === 'outbox') return value;
			return 'console' as const;
		}
	},
	MAIL_API_KEY: {
		description: 'API key of the mail provider, for MAIL_TRANSPORT=resend.',
		schema: (value) => value || ''
	},
	MAIL_FROM: {
		description: 'Sender address, e.g. "mietkartei <no-reply@mietkartei.de>".',
		schema: (value) => value || 'mietkartei <no-reply@mietkartei.de>'
	},
	STRIPE_SECRET_KEY: {
		description:
			'Stripe secret key (sk_test_… in test mode). Unset: subscriptions are not offered.',
		schema: (value) => value || ''
	},
	STRIPE_PRICE_ID: {
		description: 'Stripe price of the monthly subscription (price_…).',
		schema: (value) => value || ''
	},
	STRIPE_WEBHOOK_SECRET: {
		description: 'Signing secret of the Stripe webhook endpoint (whsec_…).',
		schema: (value) => value || ''
	},
	STRIPE_API_BASE: {
		description: 'Base URL of the Stripe API; tests point it at a fake server.',
		schema: (value) => value || 'https://api.stripe.com'
	},
	E2E: {
		description: '"true" enables the /__e2e routes the end-to-end tests use to read the outbox.',
		schema: (value) => value === 'true'
	},
	BILLING_REQUIRED: {
		description:
			'"true": once the 30-day trial has ended, accounts without an active subscription can only read.',
		schema: (value) => value === 'true'
	}
});
