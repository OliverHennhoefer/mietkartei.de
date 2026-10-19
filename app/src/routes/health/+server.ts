import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/** Used by the Docker health check and the CI smoke tests. */
export const GET: RequestHandler = async ({ locals }) => {
	await locals.db.run(sql`select 1`);
	return json({ status: 'ok' });
};
