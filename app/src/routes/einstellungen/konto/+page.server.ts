import { fail, redirect } from '@sveltejs/kit';
import { parseDeleteAccount } from '#lib/forms/auth.ts';
import { deleteAccount } from '#lib/server/accounts.ts';
import { confirmPassword } from '#lib/server/auth.ts';
import {
	auditContext,
	deleteSessionCookie,
	requireOwner,
	requireUser
} from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	return { isOwner: user.role === 'owner' };
};

export const actions: Actions = {
	// Deleting the account asks for the password again; that is the confirmation. Wrong passwords
	// count like failed sign-ins, so a stolen session cannot guess it.
	delete: async (event) => {
		const { request, locals } = event;
		const user = requireOwner(locals);
		const result = parseDeleteAccount(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors });
		const checked = await confirmPassword(locals.db, auditContext(locals), result.data.password);
		if (checked !== 'ok') {
			const password =
				checked === 'locked'
					? 'Zu viele Fehlversuche. Bitte warte 15 Minuten.'
					: 'Das Passwort stimmt nicht.';
			return fail(400, { errors: { password } });
		}
		// No storage given: the default adapter of the target deletes the documents' files. A
		// failure leaves the account (or at least its rows) in place, so the owner can try again.
		try {
			await deleteAccount(locals.db, user.accountId);
		} catch (error) {
			console.error('[account] The account was not deleted:', error);
			return fail(503, {
				failed: 'Das Konto konnte nicht gelöscht werden. Bitte versuche es erneut.'
			});
		}
		deleteSessionCookie(event);
		redirect(303, '/anmelden');
	}
};
