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
	E2E: {
		description:
			'"true" enables the /api/e2e routes the end-to-end tests use to seed data. Never set it elsewhere.',
		schema: (value) => value === 'true'
	}
});
