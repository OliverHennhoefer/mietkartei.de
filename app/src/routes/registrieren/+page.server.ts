import { fail, redirect } from '@sveltejs/kit';
import { ORIGIN } from '$app/env/private';
import { createSession, registerUser } from '#lib/server/auth.ts';
import { sendMailInBackground } from '#lib/server/mail.ts';
import { MAIL_LINKS_UNAVAILABLE, mailLinkOrigin } from '#lib/server/mail-links.ts';
import { registrationMail, requestRegistration } from '#lib/server/registration-requests.ts';
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

		// A listed address registers through the link mailed to it, so knowing the address is not
		// enough to take it. The answer is the same whether or not the address has an account.
		if (rule.emails.length > 0) {
			const origin = mailLinkOrigin(event.url, ORIGIN, __DEPLOY_TARGET__);
			if (!origin) {
				console.warn('Registration refused: set ORIGIN to the public URL of mietkartei.');
				return fail(503, {
					unavailable: MAIL_LINKS_UNAVAILABLE,
					values: { email: result.data.email }
				});
			}
			const request = await requestRegistration(db, result.data.email, result.data.password);
			if (request) {
				const link = `${origin}/registrieren/${request.token}`;
				await sendMailInBackground(db, registrationMail(request.email, link));
			}
			return { sent: true };
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
