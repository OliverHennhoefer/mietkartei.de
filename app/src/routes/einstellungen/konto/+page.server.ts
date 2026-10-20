import { fail, redirect } from '@sveltejs/kit';
import { parseDeleteAccount } from '#lib/forms/auth.ts';
import { deleteAccount } from '#lib/server/accounts.ts';
import { SESSION_COOKIE, authenticate } from '#lib/server/auth.ts';
import { requireOwner, requireUser } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	return { isOwner: user.role === 'owner' };
};

export const actions: Actions = {
	// Deleting the account asks for the password again; that is the confirmation.
	delete: async ({ request, locals, cookies }) => {
		const user = requireOwner(locals);
		const result = parseDeleteAccount(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors });
		if ((await authenticate(locals.db, user.email, result.data.password)) !== user.id) {
			return fail(400, { errors: { password: 'Das Passwort stimmt nicht.' } });
		}
		// No storage given: the default adapter of the target deletes the documents' files.
		await deleteAccount(locals.db, user.accountId);
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/registrieren');
	}
};
