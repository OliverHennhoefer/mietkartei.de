import { defineConfig } from 'drizzle-kit';

// The generated SQL migrations in drizzle/ are applied by the app on the node target and by
// `wrangler d1 migrations apply` on the cloudflare target.
export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: { url: process.env.DATABASE_PATH || './data/mietkartei.db' },
	verbose: true,
	strict: true
});
