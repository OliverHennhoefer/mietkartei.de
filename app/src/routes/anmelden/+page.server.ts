import { fail, redirect } from '@sveltejs/kit';
import { createSession, hasUsers, signIn } from '#lib/server/auth.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * Where to go after signing in: ?weiter=<path>, e.g. back to the consent page of an app. Only paths
 * of this app, so a link cannot send someone elsewhere.
 */
function nextPath(url: URL): string {
	const next = url.searchParams.get('weiter');
	return next && /^\/(?![/\\])/.test(next) ? next : '/';
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, nextPath(url));
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

		// No account has a longer address or password; refused before they are counted or hashed.
		if (email.length > 254 || password.length > 200) {
			return fail(400, { email: '', invalid: true });
		}

		// Five wrong passwords within fifteen minutes lock the address for fifteen minutes.
		const result = await signIn(event.locals.db, email, password);
		if (!result.ok) {
			if (result.reason === 'locked') return fail(429, { email, invalid: false, locked: true });
			return fail(400, { email, invalid: true });
		}

		const session = await createSession(event.locals.db, result.userId);
		setSessionCookie(event, session.token, session.expiresAt);
		redirect(303, nextPath(event.url));
	}
};
