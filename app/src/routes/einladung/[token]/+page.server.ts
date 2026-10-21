import { error, fail, redirect } from '@sveltejs/kit';
import { parseAcceptInvitation } from '#lib/forms/auth.ts';
import { createSession } from '#lib/server/auth.ts';
import { acceptInvitation, findInvitation } from '#lib/server/invitations.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const invitation = await findInvitation(locals.db, params.token);
	if (!invitation) error(404, 'Diese Einladung gibt es nicht.');
	return { email: invitation.email, status: invitation.status };
};

export const actions: Actions = {
	default: async (event) => {
		const result = parseAcceptInvitation(await event.request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		const accepted = await acceptInvitation(event.locals.db, event.params.token, result.data);
		if (!accepted.ok) {
			if (accepted.reason === 'invalid') error(404, 'Diese Einladung gibt es nicht.');
			return fail(400, { refused: accepted.reason });
		}

		const session = await createSession(event.locals.db, accepted.userId);
		setSessionCookie(event, session.token, session.expiresAt);
		redirect(303, '/');
	}
};
