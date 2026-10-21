import { fail } from '@sveltejs/kit';
import {
	parseLandlord,
	parsePasswordChange,
	parseProfile,
	type PasswordChangeInput,
	type ProfileInput
} from '#lib/forms/auth.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import { getLandlord, updateLandlord } from '#lib/server/accounts.ts';
import { changePassword, updateProfile } from '#lib/server/auth.ts';
import { auditContext, getSessionToken, requireUser } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Three forms on one page: name and address, the password, the landlord sender block. Every
// answer names the form it belongs to, so the page shows errors and confirmations in place.

const LOCKED = 'Zu viele Fehlversuche. Bitte warte 15 Minuten.';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	return {
		user: { name: user.name, email: user.email },
		landlord: await getLandlord(locals.db, user.accountId)
	};
};

export const actions: Actions = {
	profile: async ({ request, locals }) => {
		const user = requireUser(locals);
		const result = parseProfile(await request.formData(), user.email);
		if (!result.ok) {
			return fail(400, { form: 'profile' as const, errors: result.errors, values: result.values });
		}
		const updated = await updateProfile(locals.db, auditContext(locals), result.data);
		if (!updated.ok) {
			const errors: FieldErrors<ProfileInput> =
				updated.reason === 'wrong-password'
					? { currentPassword: 'Das Passwort stimmt nicht.' }
					: updated.reason === 'locked'
						? { currentPassword: LOCKED }
						: updated.reason === 'email-taken'
							? { email: 'Für diese E-Mail-Adresse gibt es schon ein Zugangskonto.' }
							: { email: 'Dein Zugang wurde nicht gefunden. Bitte melde dich neu an.' };
			return fail(400, {
				form: 'profile' as const,
				errors,
				values: { name: result.data.name ?? '', email: result.data.email }
			});
		}
		return { form: 'profile' as const, saved: true };
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
