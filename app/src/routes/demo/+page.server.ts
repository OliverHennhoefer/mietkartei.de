import { error, fail, redirect } from '@sveltejs/kit';
import { DEMO } from '$app/env/private';
import { startDemo } from '#lib/server/demo-accounts.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import { TURNSTILE_FIELD, turnstileSiteKey, verifyTurnstile } from '#lib/server/turnstile.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!DEMO) error(404, 'Nicht gefunden');
	if (locals.user) redirect(303, '/');
	return { turnstileSiteKey: turnstileSiteKey() };
};

export const actions: Actions = {
	// A post, not a link: crawlers and prefetching must not create accounts.
	default: async (event) => {
		if (!DEMO) error(404, 'Nicht gefunden');
		// Every demo writes thousands of rows, so a script must not start them.
		if (turnstileSiteKey()) {
			const form = await event.request.formData();
			if (!(await verifyTurnstile(form.get(TURNSTILE_FIELD), event.getClientAddress()))) {
				return fail(400, { botCheckFailed: true });
			}
		}
		const session = await startDemo(event.locals.db);
		if (!session) return fail(503, { busy: true });
		setSessionCookie(event, session.token, session.expiresAt);
		redirect(303, '/');
	}
};
