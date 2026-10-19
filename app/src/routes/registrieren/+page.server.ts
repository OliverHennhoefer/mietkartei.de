import { fail, redirect } from '@sveltejs/kit';
import { OPEN_REGISTRATION } from '$app/env/private';
import { createSession, hasUsers, registerUser } from '#lib/server/auth.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import type { Database } from '#lib/server/db/index.ts';
import { parseCredentials, type CredentialsInput, type FieldErrors } from '#lib/validation.ts';
import type { Actions, PageServerLoad } from './$types';

/** Without open registration, only the very first user can register. */
async function registrationOpen(db: Database): Promise<boolean> {
	return OPEN_REGISTRATION || !(await hasUsers(db));
}

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/objekte');
	return { open: await registrationOpen(locals.db) };
};

export const actions: Actions = {
	default: async (event) => {
		const { db } = event.locals;
		if (!(await registrationOpen(db))) return fail(403, { closed: true });

		const result = parseCredentials(await event.request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

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
		redirect(303, '/objekte');
	}
};
