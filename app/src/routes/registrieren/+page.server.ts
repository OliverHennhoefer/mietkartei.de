import { fail, redirect } from '@sveltejs/kit';
import { createSession, registerUser } from '#lib/server/auth.ts';
import { mayRegister, registrationOffered, registrationRule } from '#lib/server/registration.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import { TURNSTILE_FIELD, turnstileSiteKey, verifyTurnstile } from '#lib/server/turnstile.ts';
import { parseCredentials, type CredentialsInput, type FieldErrors } from '#lib/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/objekte');
	const rule = await registrationRule(locals.db);
	return {
		open: registrationOffered(rule),
		restricted: rule.emails.length > 0,
		turnstileSiteKey: turnstileSiteKey()
	};
};

export const actions: Actions = {
	default: async (event) => {
		const { db } = event.locals;
		const rule = await registrationRule(db);
		if (!registrationOffered(rule)) return fail(403, { closed: true });

		const form = await event.request.formData();
		const result = parseCredentials(form);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		if (
			turnstileSiteKey() &&
			!(await verifyTurnstile(form.get(TURNSTILE_FIELD), event.getClientAddress()))
		) {
			return fail(400, { botCheckFailed: true, values: { email: result.data.email } });
		}

		if (!mayRegister(rule, result.data.email)) {
			return fail(403, { notListed: true, values: { email: result.data.email } });
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
		redirect(303, '/objekte');
	}
};
