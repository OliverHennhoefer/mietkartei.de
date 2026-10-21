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
	E2E: {
		description:
			'"true" enables the /api/e2e routes the end-to-end tests use to seed data. Never set it elsewhere.',
		schema: (value) => value === 'true'
	}
});
