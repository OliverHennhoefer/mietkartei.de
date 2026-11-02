import { error, fail, redirect } from '@sveltejs/kit';
import { addDays, today } from '#lib/dates.ts';
import { findEntry, snooze, snoozedUntil } from '#lib/server/notifications.ts';
import { auditContext, requireUser } from '#lib/server/session.ts';
import { setDone } from '#lib/server/tasks.ts';
import type { Actions, PageServerLoad } from './$types';

// The page behind "Später erinnern" in a Hinweis: snoozes the deadline or task for the signed-in
// user, or marks a task done and goes on to the task list. A link in a mail is opened by scanners too, so nothing happens
// before a button is pressed.

/** The days a Hinweis can be put off by. */
const SNOOZE_DAYS = [3, 7, 14] as const;

async function entryOf(locals: App.Locals, key: string, origin: string) {
	const user = requireUser(locals);
	const entry = await findEntry(locals.db, user.accountId, key, origin, today());
	if (!entry) error(404, 'Diese Frist oder Aufgabe gibt es nicht mehr oder sie ist erledigt.');
	return { user, entry };
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { user, entry } = await entryOf(locals, params.key, url.origin);
	return {
		entry: {
			kind: entry.kind,
			title: entry.title,
			date: entry.date,
			overdue: entry.overdue,
			description: entry.description,
			href: entry.url.slice(url.origin.length)
		},
		snoozedUntil: await snoozedUntil(locals.db, user.id, entry, today()),
		days: SNOOZE_DAYS,
		canComplete: entry.kind === 'task' && user.role !== 'viewer'
	};
};

export const actions: Actions = {
	snooze: async ({ locals, params, request, url }) => {
		const { user, entry } = await entryOf(locals, params.key, url.origin);
		const days = Number((await request.formData()).get('days'));
		if (!SNOOZE_DAYS.includes(days as (typeof SNOOZE_DAYS)[number])) {
			return fail(400, { message: 'So lange geht es nicht.' });
		}
		const until = addDays(today(), days);
		await snooze(locals.db, { accountId: user.accountId, userId: user.id }, entry, until);
		return { snoozed: until };
	},
	done: async ({ locals, params, url }) => {
		const { user, entry } = await entryOf(locals, params.key, url.origin);
		if (entry.kind !== 'task' || user.role === 'viewer') {
			return fail(400, { message: 'Nur Aufgaben lassen sich hier erledigen.' });
		}
		await setDone(locals.db, auditContext(locals), entry.key.slice('task-'.length), true);
		// Done, the task is no longer an entry and this page has nothing left to show.
		redirect(303, '/aufgaben');
	}
};
