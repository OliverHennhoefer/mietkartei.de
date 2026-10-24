import { fail } from '@sveltejs/kit';
import { ORIGIN } from '$app/env/private';
import { parseInvitation, parseRoleChange, type InvitationFormInput } from '#lib/forms/auth.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import {
	changeRole,
	createInvitation,
	deliverInvitation,
	freeSeats,
	invitationMail,
	listAccountUsers,
	listPendingInvitations,
	MAX_ACCOUNT_MEMBERS,
	removeUser,
	resendInvitation,
	revokeInvitation
} from '#lib/server/invitations.ts';
import { sendMail } from '#lib/server/mail.ts';
import { MAIL_LINKS_UNAVAILABLE, mailLinkOrigin } from '#lib/server/mail-links.ts';
import { auditContext, requireOwner } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Owners only: who has access to the account and with which role, invitations, and the form to
// invite.

const FULL = `Ein Konto hat höchstens ${MAX_ACCOUNT_MEMBERS} Zugänge, offene Einladungen eingerechnet. Entferne einen Zugang oder ziehe eine Einladung zurück.`;
const TOO_MANY =
	'Du hast heute schon viele Einladungen verschickt. Bitte versuche es morgen wieder.';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireOwner(locals);
	const [accountUsers, pending, seats] = await Promise.all([
		listAccountUsers(locals.db, user.accountId),
		listPendingInvitations(locals.db, user.accountId),
		freeSeats(locals.db, user.accountId)
	]);
	return {
		userId: user.id,
		users: accountUsers,
		invitations: pending,
		freeSeats: seats,
		maxMembers: MAX_ACCOUNT_MEMBERS
	};
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
						? 'Diese E-Mail-Adresse ist schon eingeladen. Schicke die Einladung unten erneut.'
						: created.reason === 'full'
							? FULL
							: TOO_MANY;
			const errors: FieldErrors<InvitationFormInput> = { email: message };
			return fail(400, { errors, values: result.data });
		}
		// The token is in the mail only; the database holds its hash.
		const sent = await deliverInvitation(
			locals.db,
			auditContext(locals),
			created.id,
			invitationMail(
				created.email,
				`${origin}/einladung/${created.token}`,
				user.name,
				created.role
			),
			(mail) => sendMail(locals.db, mail)
		);
		if (!sent) {
			const errors: FieldErrors<InvitationFormInput> = {
				email:
					'Die Einladung konnte nicht verschickt werden und wurde zurückgezogen. Bitte versuche es später noch einmal.'
			};
			return fail(502, { errors, values: { email: created.email, role: created.role } });
		}
		return { invited: created.email };
	},

	resend: async ({ request, locals, url }) => {
		const user = requireOwner(locals);
		const form = await request.formData();
		const id = form.get('invitationId');
		if (typeof id !== 'string' || !id)
			return fail(400, { refused: 'Diese Einladung gibt es nicht.' });
		const origin = mailLinkOrigin(url, ORIGIN, __DEPLOY_TARGET__);
		if (!origin) {
			console.warn('Invitation refused: set ORIGIN to the public URL of mietkartei.');
			return fail(503, { refused: MAIL_LINKS_UNAVAILABLE });
		}
		const resent = await resendInvitation(locals.db, auditContext(locals), id);
		if (!resent.ok) {
			const refused =
				resent.reason === 'missing'
					? 'Diese Einladung gibt es nicht mehr.'
					: resent.reason === 'full'
						? FULL
						: TOO_MANY;
			return fail(resent.reason === 'missing' ? 404 : 400, { refused });
		}
		const sent = await deliverInvitation(
			locals.db,
			auditContext(locals),
			resent.id,
			invitationMail(resent.email, `${origin}/einladung/${resent.token}`, user.name, resent.role),
			(mail) => sendMail(locals.db, mail)
		);
		if (!sent) {
			return fail(502, {
				refused:
					'Die Einladung konnte nicht verschickt werden und wurde zurückgezogen. Bitte lade die Person später neu ein.'
			});
		}
		return { invited: resent.email };
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

	role: async ({ request, locals }) => {
		requireOwner(locals);
		const result = parseRoleChange(await request.formData());
		if (!result.ok) return fail(400, { refused: 'Bitte wähle eine gültige Rolle aus.' });
		const changed = await changeRole(
			locals.db,
			auditContext(locals),
			result.data.userId,
			result.data.role
		);
		if (changed === 'self') {
			return fail(400, { refused: 'Deine eigene Rolle kannst du nicht ändern.' });
		}
		if (changed === 'owner') {
			return fail(400, { refused: 'Die Rolle des Vermieters kann niemand ändern.' });
		}
		if (changed === 'missing') return fail(404, { refused: 'Diesen Zugang gibt es nicht.' });
		return { roleChanged: true };
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
