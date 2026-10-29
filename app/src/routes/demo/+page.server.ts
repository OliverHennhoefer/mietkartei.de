import { error, fail, redirect } from '@sveltejs/kit';
import { DEMO } from '$app/env/private';
import { startDemo } from '#lib/server/demo-accounts.ts';
import { referenceCase } from '#lib/server/reference-demo.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import { TURNSTILE_FIELD, turnstileSiteKey, verifyTurnstile } from '#lib/server/turnstile.ts';
import type { Actions, PageServerLoad } from './$types';

// /demo?beispiel=<slug>, linked from a Rechenbeispiel on mietkartei.de: a demo holding only that
// case, opened on its statement. Any other value starts the full demo.
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!DEMO) error(404, 'Nicht gefunden');
	const example = referenceCase(url.searchParams.get('beispiel'));
	// A visitor with a demo running gets the example as a new one; the old one expires on its own.
	if (locals.user && !example) redirect(303, '/');
	return {
		turnstileSiteKey: turnstileSiteKey(),
		example: example ? { slug: example.slug, title: example.title, year: example.year } : null
	};
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
		const example = referenceCase(event.url.searchParams.get('beispiel'));
		const session = await startDemo(event.locals.db, { example });
		if (!session) return fail(503, { busy: true });
		setSessionCookie(event, session.token, session.expiresAt);
		redirect(303, session.home);
	}
};
