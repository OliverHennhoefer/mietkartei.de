import { redirect } from '@sveltejs/kit';
import { deleteSession } from '#lib/server/auth.ts';
import { deleteSessionCookie, getSessionToken } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Signing out changes state, so it only happens through the form in the header.
export const load: PageServerLoad = () => {
	redirect(303, '/objekte');
};

export const actions: Actions = {
	default: async (event) => {
		const token = getSessionToken(event);
		if (token) await deleteSession(event.locals.db, token);
		deleteSessionCookie(event);
		redirect(303, '/anmelden');
	}
};
