import { fail, redirect } from '@sveltejs/kit';
import { authenticate, createSession, hasUsers } from '#lib/server/auth.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/objekte');
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

		const userId = await authenticate(event.locals.db, email, password);
		if (!userId) return fail(400, { email, invalid: true });

		const session = await createSession(event.locals.db, userId);
		setSessionCookie(event, session.token, session.expiresAt);
		redirect(303, '/objekte');
	}
};
