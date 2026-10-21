import { fail, redirect } from '@sveltejs/kit';
import { OPEN_REGISTRATION } from '$app/env/private';
import { createSession, hasUsers, registerUser } from '#lib/server/auth.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import { TURNSTILE_FIELD, turnstileSiteKey, verifyTurnstile } from '#lib/server/turnstile.ts';
import type { Database } from '#lib/server/db/index.ts';
import { parseCredentials, type CredentialsInput, type FieldErrors } from '#lib/validation.ts';
import type { Actions, PageServerLoad } from './$types';

/** Without open registration, only the very first user can register. */
async function registrationOpen(db: Database): Promise<boolean> {
	return OPEN_REGISTRATION || !(await hasUsers(db));
}

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return { open: await registrationOpen(locals.db), turnstileSiteKey: turnstileSiteKey() };
};

export const actions: Actions = {
	default: async (event) => {
		const { db } = event.locals;
		if (!(await registrationOpen(db))) return fail(403, { closed: true });

		const form = await event.request.formData();
		const result = parseCredentials(form);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		if (
			turnstileSiteKey() &&
			!(await verifyTurnstile(form.get(TURNSTILE_FIELD), event.getClientAddress()))
		) {
			return fail(400, { botCheckFailed: true, values: { email: result.data.email } });
		}

		const registered = await registerUser(db, result.data.email, result.data.password);
		if (!registered.ok) {
			const errors: FieldErrors<CredentialsInput> = {
				email:
					registered.reason === 'email-taken'
						? 'Für diese E-Mail-Adresse gibt es schon ein Konto.'
						: 'Gerade hat sich jemand anderes registriert. Bitte versuche es noch einmal.'
			};
			return fail(400, { errors, values: { email: result.data.email } });
		}

		const session = await createSession(db, registered.userId);
		setSessionCookie(event, session.token, session.expiresAt);
		redirect(303, '/');
	}
};
