import { error, json } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import { E2E } from '$app/env/private';
import { outbox } from '#lib/server/db/schema.ts';
import type { RequestHandler } from './$types';

/** The mails stored by MAIL_TRANSPORT=outbox, newest first. Only for the end-to-end tests. */
export const GET: RequestHandler = async ({ locals }) => {
	if (!E2E) error(404, 'Nicht gefunden');
	const mails = await locals.db.select().from(outbox).orderBy(desc(outbox.createdAt)).limit(50);
	return json(mails);
};
