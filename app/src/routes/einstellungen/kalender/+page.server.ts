import { fail } from '@sveltejs/kit';
import {
	calendarPath,
	createCalendarFeed,
	deleteCalendarFeed,
	getCalendarFeed
} from '#lib/server/calendar.ts';
import { auditContext, requireUser } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return { feed: await getCalendarFeed(locals.db, requireUser(locals).id) };
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
	}
};
