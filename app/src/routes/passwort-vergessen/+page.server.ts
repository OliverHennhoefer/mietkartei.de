import { fail, redirect } from '@sveltejs/kit';
import { parseEmailForm } from '#lib/forms/auth.ts';
import { sendMail } from '#lib/server/mail.ts';
import { passwordResetMail, requestPasswordReset } from '#lib/server/password-resets.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/einstellungen/profil');
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const result = parseEmailForm(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		// The answer is the same whether or not the address has an account.
		const reset = await requestPasswordReset(locals.db, result.data.email);
		if (reset) {
			const link = `${url.origin}/passwort-zuruecksetzen/${reset.token}`;
			await sendMail(locals.db, passwordResetMail(reset.email, link));
		}
		return { sent: true };
	}
};
