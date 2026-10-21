import { fail, redirect } from '@sveltejs/kit';
import { ORIGIN } from '$app/env/private';
import { parseEmailForm } from '#lib/forms/auth.ts';
import { sendMail } from '#lib/server/mail.ts';
import {
	passwordResetMail,
	requestPasswordReset,
	resetLinkOrigin
} from '#lib/server/password-resets.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/einstellungen/profil');
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const result = parseEmailForm(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		// Refused before the address is looked up, so this answer says nothing about accounts.
		const origin = resetLinkOrigin(url, ORIGIN, __DEPLOY_TARGET__);
		if (!origin) {
			console.warn('Password reset refused: set ORIGIN to the public URL of mietkartei.');
			return fail(503, {
				unavailable:
					'Passwort-Links per E-Mail sind hier noch nicht eingerichtet: Wer mietkartei betreibt, muss dafür ORIGIN auf die öffentliche Adresse setzen.'
			});
		}
		// The answer is the same whether or not the address has an account.
		const reset = await requestPasswordReset(locals.db, result.data.email);
		if (reset) {
			const link = `${origin}/passwort-zuruecksetzen/${reset.token}`;
			await sendMail(locals.db, passwordResetMail(reset.email, link));
		}
		return { sent: true };
	}
};
