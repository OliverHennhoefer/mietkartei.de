import { fail } from '@sveltejs/kit';
import { DEMO, ORIGIN } from '$app/env/private';
import {
	calendarPath,
	createCalendarFeed,
	deleteCalendarFeed,
	getCalendarFeed
} from '#lib/server/calendar.ts';
import { getDeadlineMail, setDeadlineMail } from '#lib/server/deadline-mails.ts';
import { auditContext, requireUser } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	const [feed, mail] = await Promise.all([
		getCalendarFeed(locals.db, user.id),
		getDeadlineMail(locals.db, user.id)
	]);
	return {
		feed,
		deadlineMail: { on: mail.origin !== null, sentOn: mail.sentOn, email: user.email },
		demo: DEMO
	};
};

export const actions: Actions = {
	create: async ({ locals, url }) => {
		const token = await createCalendarFeed(locals.db, auditContext(locals));
		return { link: `${url.origin}${calendarPath(token)}` };
	},
	delete: async ({ locals }) => {
		if (!(await deleteCalendarFeed(locals.db, auditContext(locals)))) {
			return fail(404, { message: 'Es gibt keinen Kalender-Link.' });
		}
		return { deleted: true };
	},
	mail: async ({ locals, request, url }) => {
		const user = requireUser(locals);
		const on = (await request.formData()).get('on') === 'true';
		// The links in the mail lead to the address the app is opened at, or the configured one.
		await setDeadlineMail(
			locals.db,
			user.id,
			on ? (ORIGIN ? new URL(ORIGIN).origin : url.origin) : null
		);
		return { mailSaved: on };
	}
};
