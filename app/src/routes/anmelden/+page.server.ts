import { fail, redirect } from '@sveltejs/kit';
import { createSession, hasUsers, signIn } from '#lib/server/auth.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	// A new instance has no users yet; the first one has to register.
	if (!(await hasUsers(locals.db))) redirect(303, '/registrieren');
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const email = form.get('email');
		const password = form.get('password');
		if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
			return fail(400, { email: typeof email === 'string' ? email : '', invalid: true });
		}

		// Five wrong passwords within fifteen minutes lock the address for fifteen minutes.
		const result = await signIn(event.locals.db, email, password);
		if (!result.ok) {
			if (result.reason === 'locked') return fail(429, { email, invalid: false, locked: true });
			return fail(400, { email, invalid: true });
		}

		const session = await createSession(event.locals.db, result.userId);
		setSessionCookie(event, session.token, session.expiresAt);
		redirect(303, '/');
	}
};
