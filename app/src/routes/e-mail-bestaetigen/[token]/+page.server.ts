import { error, fail, redirect } from '@sveltejs/kit';
import { confirmEmailChange, findEmailChange } from '#lib/server/email-changes.ts';
import { getSessionToken } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Opened from the mail to the new address, signed in or not. Confirming takes a click, so a mail
// scanner that follows the link does not change the address.

const INVALID_LINK =
	'Dieser Link ist ungültig oder abgelaufen. Beantrage die neue E-Mail-Adresse noch einmal in deinem Profil.';

export const load: PageServerLoad = async ({ locals, params }) => {
	// A used token is deleted, so unknown, expired and used links all end here.
	const change = await findEmailChange(locals.db, params.token);
	if (!change) error(404, INVALID_LINK);
	return { email: change.email };
};

export const actions: Actions = {
	default: async (event) => {
		// The session of this browser stays, if it is the user's; every other one is ended.
		const confirmed = await confirmEmailChange(
			event.locals.db,
			event.params.token,
			getSessionToken(event)
		);
		if (!confirmed.ok) {
			if (confirmed.reason === 'invalid') error(404, INVALID_LINK);
			return fail(400, { taken: true });
		}
		// The link is used up, so the page cannot show it again.
		redirect(
			303,
			event.locals.user?.id === confirmed.userId ? '/einstellungen/profil' : '/anmelden'
		);
	}
};
