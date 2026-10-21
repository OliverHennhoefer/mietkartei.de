import { fail } from '@sveltejs/kit';
import { ORIGIN } from '$app/env/private';
import {
	parseLandlord,
	parsePasswordChange,
	parseProfile,
	type PasswordChangeInput,
	type ProfileInput
} from '#lib/forms/auth.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import { getLandlord, updateLandlord } from '#lib/server/accounts.ts';
import { changePassword, updateName } from '#lib/server/auth.ts';
import {
	emailChangeMail,
	emailChangeNoticeMail,
	requestEmailChange
} from '#lib/server/email-changes.ts';
import { sendMail } from '#lib/server/mail.ts';
import { MAIL_LINKS_UNAVAILABLE, mailLinkOrigin } from '#lib/server/mail-links.ts';
import { auditContext, getSessionToken, requireUser } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Three forms on one page: name and address, the password, the landlord sender block. Every
// answer names the form it belongs to, so the page shows errors and confirmations in place. A new
// address takes effect only through the link mailed to it (see email-changes.ts).

const LOCKED = 'Zu viele Fehlversuche. Bitte warte 15 Minuten.';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	return {
		user: { name: user.name, email: user.email },
		landlord: await getLandlord(locals.db, user.accountId)
	};
};

export const actions: Actions = {
	profile: async ({ request, locals, url }) => {
		const user = requireUser(locals);
		const result = parseProfile(await request.formData(), user.email);
		if (!result.ok) {
			return fail(400, { form: 'profile' as const, errors: result.errors, values: result.values });
		}
		const values = { name: result.data.name ?? '', email: result.data.email };
		let pendingEmail: string | undefined;
		if (result.data.email !== user.email) {
			const origin = mailLinkOrigin(url, ORIGIN, __DEPLOY_TARGET__);
			if (!origin) {
				console.warn('Email change refused: set ORIGIN to the public URL of mietkartei.');
				const errors: FieldErrors<ProfileInput> = { email: MAIL_LINKS_UNAVAILABLE };
				return fail(503, { form: 'profile' as const, errors, values });
			}
			const requested = await requestEmailChange(locals.db, auditContext(locals), result.data);
			if (!requested.ok) {
				const errors: FieldErrors<ProfileInput> =
					requested.reason === 'wrong-password'
						? { currentPassword: 'Das Passwort stimmt nicht.' }
						: requested.reason === 'locked'
							? { currentPassword: LOCKED }
							: requested.reason === 'email-taken'
								? { email: 'Für diese E-Mail-Adresse gibt es schon ein Zugangskonto.' }
								: requested.reason === 'too-many'
									? {
											email:
												'Du hast heute schon oft eine neue Adresse beantragt. Bitte versuche es morgen wieder.'
										}
									: { email: 'Dein Zugang wurde nicht gefunden. Bitte melde dich neu an.' };
				return fail(400, { form: 'profile' as const, errors, values });
			}
			// The token is in the mail only; the database holds its hash.
			const link = `${origin}/e-mail-bestaetigen/${requested.token}`;
			await sendMail(locals.db, emailChangeMail(requested.email, link));
			await sendMail(locals.db, emailChangeNoticeMail(requested.previousEmail, requested.email));
			pendingEmail = requested.email;
		}
		if (result.data.name !== user.name) {
			await updateName(locals.db, auditContext(locals), result.data.name);
		}
		return { form: 'profile' as const, saved: true, pendingEmail };
	},

	password: async (event) => {
		const { request, locals } = event;
		requireUser(locals);
		const result = parsePasswordChange(await request.formData());
		if (!result.ok) return fail(400, { form: 'password' as const, errors: result.errors });
		// The session of this browser stays; every other one is ended.
		const changed = await changePassword(locals.db, auditContext(locals), {
			currentPassword: result.data.currentPassword,
			password: result.data.password,
			keepToken: getSessionToken(event)
		});
		if (!changed.ok) {
			const errors: FieldErrors<PasswordChangeInput> = {
				currentPassword:
					changed.reason === 'wrong-password'
						? 'Das aktuelle Passwort stimmt nicht.'
						: changed.reason === 'locked'
							? LOCKED
							: 'Dein Zugang wurde nicht gefunden. Bitte melde dich neu an.'
			};
			return fail(400, { form: 'password' as const, errors });
		}
		return { form: 'password' as const, saved: true };
	},

	landlord: async ({ request, locals }) => {
		const result = parseLandlord(await request.formData());
		if (!result.ok) {
			return fail(400, { form: 'landlord' as const, errors: result.errors, values: result.values });
		}
		await updateLandlord(locals.db, auditContext(locals), result.data);
		return { form: 'landlord' as const, saved: true };
	}
};
