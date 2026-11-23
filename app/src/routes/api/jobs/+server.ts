import { error, json } from '@sveltejs/kit';
import { DEMO } from '$app/env/private';
import { redeleteAccounts } from '#lib/server/accounts.ts';
import { sendDueDeadlineMails } from '#lib/server/deadline-mails.ts';
import { isJobRequest } from '#lib/server/jobs.ts';
import { deleteExpired } from '#lib/server/lettings.ts';
import { sendDueNotifications } from '#lib/server/notifications.ts';
import type { RequestHandler } from './$types';

// The scheduled jobs (the weekly Fristenübersicht, the day's Hinweise, deleting Mietinteressenten
// whose retention period is over and deleting again accounts a restore brought back), posted every hour by server.js or worker.js; see
// #lib/server/jobs.ts. Any other request gets 404, like a page that does not exist. The demo sends
// nothing, and its accounts are deleted after a day anyway.
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!isJobRequest(request)) error(404, 'Not found');
	if (DEMO) {
		return json({ deadlineMails: 0, notifications: 0, deletedApplicants: 0, redeletedAccounts: 0 });
	}
	// Each job on its own: one that fails is logged and reported, and the others still run, so a
	// failing deletion does not hold back the mails and a failing mail keeps no data past its
	// deletion date. The deletions come first.
	const failed: string[] = [];
	const run = async (name: string, job: () => Promise<number>): Promise<number> => {
		try {
			return await job();
		} catch (cause) {
			console.error(`[jobs] ${name} failed:`, cause);
			failed.push(name);
			return 0;
		}
	};
	const deletedApplicants = await run('deletedApplicants', () => deleteExpired(locals.db));
	const redeletedAccounts = await run('redeletedAccounts', () => redeleteAccounts(locals.db));
	const deadlineMails = await run('deadlineMails', () => sendDueDeadlineMails(locals.db));
	const notifications = await run('notifications', () => sendDueNotifications(locals.db));
	return json(
		{
			deadlineMails,
			notifications,
			deletedApplicants,
			redeletedAccounts,
			...(failed.length > 0 ? { failed } : {})
		},
		// The caller logs any answer that is not 2xx.
		{ status: failed.length > 0 ? 500 : 200 }
	);
};
