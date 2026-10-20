import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, deleteSession } from '#lib/server/auth.ts';
import type { Actions, PageServerLoad } from './$types';

// Signing out changes state, so it only happens through the form in the header.
export const load: PageServerLoad = () => {
	redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ cookies, locals }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) await deleteSession(locals.db, token);
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/anmelden');
	}
};
