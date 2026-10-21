import { fail } from '@sveltejs/kit';
import { ORIGIN } from '$app/env/private';
import { parseInvitation, type InvitationFormInput } from '#lib/forms/auth.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import {
	createInvitation,
	invitationMail,
	listAccountUsers,
	listPendingInvitations,
	removeUser,
	revokeInvitation
} from '#lib/server/invitations.ts';
import { sendMail } from '#lib/server/mail.ts';
import { MAIL_LINKS_UNAVAILABLE, mailLinkOrigin } from '#lib/server/mail-links.ts';
import { auditContext, requireOwner } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Owners only: who has access to the account, open invitations, and the form to invite.

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireOwner(locals);
	const [accountUsers, pending] = await Promise.all([
		listAccountUsers(locals.db, user.accountId),
		listPendingInvitations(locals.db, user.accountId)
	]);
	return { userId: user.id, users: accountUsers, invitations: pending };
};

export const actions: Actions = {
	invite: async ({ request, locals, url }) => {
		const user = requireOwner(locals);
		const result = parseInvitation(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		// Checked first, so no invitation is stored that could not be sent.
		const origin = mailLinkOrigin(url, ORIGIN, __DEPLOY_TARGET__);
		if (!origin) {
			console.warn('Invitation refused: set ORIGIN to the public URL of mietkartei.');
			return fail(503, { refused: MAIL_LINKS_UNAVAILABLE });
		}
		const created = await createInvitation(locals.db, auditContext(locals), result.data);
		if (!created.ok) {
			const message =
				created.reason === 'member'
					? 'Diese Person hat schon einen Zugang zu deinem Konto.'
					: created.reason === 'already-invited'
						? 'Diese E-Mail-Adresse ist schon eingeladen. Ziehe die Einladung zurück, um sie neu zu schicken.'
						: 'Du hast heute schon viele Einladungen verschickt. Bitte versuche es morgen wieder.';
			const errors: FieldErrors<InvitationFormInput> = { email: message };
			return fail(400, { errors, values: { email: result.data.email } });
		}
		// The token is in the mail only; the database holds its hash.
		await sendMail(
			locals.db,
			invitationMail(created.email, `${origin}/einladung/${created.token}`, user.name)
		);
		return { invited: created.email };
	},

	revoke: async ({ request, locals }) => {
		requireOwner(locals);
		const form = await request.formData();
		const id = form.get('invitationId');
		if (typeof id !== 'string' || !id)
			return fail(400, { refused: 'Diese Einladung gibt es nicht.' });
		if (!(await revokeInvitation(locals.db, auditContext(locals), id))) {
			return fail(404, { refused: 'Diese Einladung gibt es nicht mehr.' });
		}
		return { revoked: true };
	},

	remove: async ({ request, locals }) => {
		requireOwner(locals);
		const form = await request.formData();
		const userId = form.get('userId');
		if (typeof userId !== 'string' || !userId) {
			return fail(400, { refused: 'Diesen Zugang gibt es nicht.' });
		}
		const removed = await removeUser(locals.db, auditContext(locals), userId);
		if (removed === 'self') {
			return fail(400, { refused: 'Deinen eigenen Zugang kannst du nicht entfernen.' });
		}
		if (removed === 'owner') {
			return fail(400, { refused: 'Den Zugang des Vermieters kann niemand entfernen.' });
		}
		if (removed === 'missing') return fail(404, { refused: 'Diesen Zugang gibt es nicht.' });
		return { removed: true };
	}
};
