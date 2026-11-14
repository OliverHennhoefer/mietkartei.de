import { error, json } from '@sveltejs/kit';
import { DEMO } from '$app/env/private';
import { sendDueDeadlineMails } from '#lib/server/deadline-mails.ts';
import { isJobRequest } from '#lib/server/jobs.ts';
import { deleteExpired } from '#lib/server/lettings.ts';
import { sendDueNotifications } from '#lib/server/notifications.ts';
import type { RequestHandler } from './$types';

// The scheduled jobs (the weekly Fristenübersicht, the day's Hinweise and deleting Mietinteressenten
// whose retention period is over), posted every hour by server.js or worker.js; see
// #lib/server/jobs.ts. Any other request gets 404, like a page that does not exist. The demo sends
// nothing, and its accounts are deleted after a day anyway.
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!isJobRequest(request)) error(404, 'Not found');
	if (DEMO) return json({ deadlineMails: 0, notifications: 0, deletedApplicants: 0 });
	// First, so a failing mail does not keep data past its deletion date.
	const deletedApplicants = await deleteExpired(locals.db);
	return json({
		deadlineMails: await sendDueDeadlineMails(locals.db),
		notifications: await sendDueNotifications(locals.db),
		deletedApplicants
	});
};
