import { error, fail, redirect } from '@sveltejs/kit';
import { createSession } from '#lib/server/auth.ts';
import {
	completeRegistration,
	findRegistrationRequest
} from '#lib/server/registration-requests.ts';
import { mayRegister, registrationRule } from '#lib/server/registration.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Opened from the registration mail. Creating the account takes a click, so a mail scanner that
// follows the link creates nothing.

const INVALID_LINK =
	'Dieser Link ist ungültig oder abgelaufen. Registriere dich bitte noch einmal.';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (locals.user) redirect(303, '/');
	// A used token is deleted, so unknown, expired and used links all end here.
	const request = await findRegistrationRequest(locals.db, params.token);
	if (!request) error(404, INVALID_LINK);
	return { email: request.email };
};

export const actions: Actions = {
	default: async (event) => {
		const { db } = event.locals;
		const request = await findRegistrationRequest(db, event.params.token);
		if (!request) error(404, INVALID_LINK);
		// The address may have left REGISTRATION_EMAILS since the mail was sent.
		if (!mayRegister(await registrationRule(db), request.email)) return fail(403, { closed: true });

		const registered = await completeRegistration(db, request);
		if (!registered.ok) {
			return fail(400, registered.reason === 'email-taken' ? { taken: true } : { retry: true });
		}
		const session = await createSession(db, registered.userId);
		setSessionCookie(event, session.token, session.expiresAt);
		redirect(303, '/');
	}
};
