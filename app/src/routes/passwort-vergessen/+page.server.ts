import { fail, redirect } from '@sveltejs/kit';
import { ORIGIN } from '$app/env/private';
import { parseEmailForm } from '#lib/forms/auth.ts';
import { sendMailInBackground } from '#lib/server/mail.ts';
import { MAIL_LINKS_UNAVAILABLE, mailLinkOrigin } from '#lib/server/mail-links.ts';
import { passwordResetMail, requestPasswordReset } from '#lib/server/password-resets.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/einstellungen/profil');
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const result = parseEmailForm(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		// Refused before the address is looked up, so this answer says nothing about accounts.
		const origin = mailLinkOrigin(url, ORIGIN, __DEPLOY_TARGET__);
		if (!origin) {
			console.warn('Password reset refused: set ORIGIN to the public URL of mietkartei.');
			return fail(503, { unavailable: MAIL_LINKS_UNAVAILABLE });
		}
		// The answer is the same whether or not the address has an account: the mail goes out
		// after the response, and a failure to send it is only logged.
		const reset = await requestPasswordReset(locals.db, result.data.email);
		if (reset) {
			const link = `${origin}/passwort-zuruecksetzen/${reset.token}`;
			await sendMailInBackground(locals.db, passwordResetMail(reset.email, link));
		}
		return { sent: true };
	}
};
