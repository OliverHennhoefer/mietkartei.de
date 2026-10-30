import { error, json } from '@sveltejs/kit';
import { DEMO } from '$app/env/private';
import { sendDueDeadlineMails } from '#lib/server/deadline-mails.ts';
import { isJobRequest } from '#lib/server/jobs.ts';
import type { RequestHandler } from './$types';

// The scheduled jobs, posted by server.js or worker.js; see #lib/server/jobs.ts. Any other request
// gets 404, like a page that does not exist. The demo sends no mails.
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!isJobRequest(request)) error(404, 'Not found');
	if (DEMO) return json({ deadlineMails: 0 });
	return json({ deadlineMails: await sendDueDeadlineMails(locals.db) });
};
