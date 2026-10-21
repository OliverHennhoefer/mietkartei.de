import { fail, redirect } from '@sveltejs/kit';
import { ORIGIN } from '$app/env/private';
import { parseEmailForm } from '#lib/forms/auth.ts';
import { createSession, registerUser } from '#lib/server/auth.ts';
import { sendMailInBackground } from '#lib/server/mail.ts';
import { MAIL_LINKS_UNAVAILABLE, mailLinkOrigin } from '#lib/server/mail-links.ts';
import {
	registrationMail,
	requestRegistration,
	withdrawRegistrationRequest
} from '#lib/server/registration-requests.ts';
import { mayRegister, registrationOffered, registrationRule } from '#lib/server/registration.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import { TURNSTILE_FIELD, turnstileSiteKey, verifyTurnstile } from '#lib/server/turnstile.ts';
import { parseCredentials, type CredentialsInput, type FieldErrors } from '#lib/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
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

		// A listed address gives only the address here: the link mailed to it leads to the page
		// that sets the password, so knowing an address is not enough to take or prepare it.
		const restricted = rule.emails.length > 0;
		const form = await event.request.formData();
		const result = restricted ? parseEmailForm(form) : parseCredentials(form);
		if (!result.ok) {
			const errors: FieldErrors<CredentialsInput> = result.errors;
			return fail(400, { errors, values: result.values });
		}
		const { email } = result.data;
		if (
			turnstileSiteKey() &&
			!(await verifyTurnstile(form.get(TURNSTILE_FIELD), event.getClientAddress()))
		) {
			return fail(400, { botCheckFailed: true, values: { email } });
		}
		if (!mayRegister(rule, email)) return fail(403, { notListed: true, values: { email } });

		if (restricted) {
			const origin = mailLinkOrigin(event.url, ORIGIN, __DEPLOY_TARGET__);
			if (!origin) {
				console.warn('Registration refused: set ORIGIN to the public URL of mietkartei.');
				return fail(503, { unavailable: MAIL_LINKS_UNAVAILABLE, values: { email } });
			}
			// The answer is the same whether or not the address has an account.
			const request = await requestRegistration(db, email);
			if (request) {
				const link = `${origin}/registrieren/${request.token}`;
				// A link that never arrived must not count toward the open requests of the address.
				await sendMailInBackground(db, registrationMail(request.email, link), () =>
					withdrawRegistrationRequest(db, request.token)
				);
			}
			return { sent: true };
		}

		// Unrestricted, the form was parsed with parseCredentials.
		const { password } = result.data as CredentialsInput;
		const registered = await registerUser(db, email, password);
		if (!registered.ok) {
			const errors: FieldErrors<CredentialsInput> = {
				email:
					registered.reason === 'email-taken'
						? 'Für diese E-Mail-Adresse gibt es schon ein Konto.'
						: 'Gerade hat sich jemand anderes registriert. Bitte versuche es noch einmal.'
			};
			return fail(400, { errors, values: { email } });
		}

		const session = await createSession(db, registered.userId);
		setSessionCookie(event, session.token, session.expiresAt);
		redirect(303, '/');
	}
};
