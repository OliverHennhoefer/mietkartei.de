import { error, fail, redirect } from '@sveltejs/kit';
import { parseNewPassword } from '#lib/forms/auth.ts';
import { createSession } from '#lib/server/auth.ts';
import { findPasswordReset, resetPassword } from '#lib/server/password-resets.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

const INVALID_LINK =
	'Dieser Link ist ungültig oder abgelaufen. Fordere unter „Passwort vergessen“ einen neuen an.';

export const load: PageServerLoad = async ({ locals, params }) => {
	// A used token is deleted, so unknown, expired and used links all end here.
	if (!(await findPasswordReset(locals.db, params.token))) error(404, INVALID_LINK);
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const result = parseNewPassword(await event.request.formData());
		if (!result.ok) return fail(400, { errors: result.errors });

		const reset = await resetPassword(event.locals.db, event.params.token, result.data.password);
		if (!reset.ok) error(404, INVALID_LINK);

		// The reset ended every session of the user; this browser gets a fresh one.
		const session = await createSession(event.locals.db, reset.userId);
		setSessionCookie(event, session.token, session.expiresAt);
		redirect(303, '/');
	}
};
