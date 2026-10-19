import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import type { Database } from './index';
import * as schema from './schema';

/** Migrations are applied by `wrangler d1 migrations apply`, not at runtime. */
export function openD1(): Database {
	if (!env.DB) throw new Error('The D1 binding "DB" is not configured in wrangler.jsonc');
	return drizzle(env.DB, { schema });
}
