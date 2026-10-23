import { error, redirect } from '@sveltejs/kit';
import { DEMO } from '$app/env/private';
import { startDemo } from '#lib/server/demo-accounts.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!DEMO) error(404, 'Nicht gefunden');
	if (locals.user) redirect(303, '/');
};

export const actions: Actions = {
	// A post, not a link: crawlers and prefetching must not create accounts.
	default: async (event) => {
		if (!DEMO) error(404, 'Nicht gefunden');
		const session = await startDemo(event.locals.db);
		setSessionCookie(event, session.token, session.expiresAt);
		redirect(303, '/');
	}
};
