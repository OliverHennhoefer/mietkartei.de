import { fail, redirect } from '@sveltejs/kit';
import { parseDeleteAccount } from '#lib/forms/auth.ts';
import { deleteAccount } from '#lib/server/accounts.ts';
import { SESSION_COOKIE, authenticate } from '#lib/server/auth.ts';
import {
	billingEnabled,
	cancelSubscriptionOf,
	getBillingAccount,
	subscriptionRuns
} from '#lib/server/billing.ts';
import { createDemoData, isEmptyAccount } from '#lib/server/demo.ts';
import { auditContext, requireOwner, requireUser } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	const isOwner = user.role === 'owner';
	return {
		isOwner,
		canLoadDemo: isOwner && (await isEmptyAccount(locals.db, user.accountId)),
		subscriptionRuns:
			isOwner &&
			billingEnabled() &&
			subscriptionRuns(await getBillingAccount(locals.db, user.accountId))
	};
};

export const actions: Actions = {
	// Demo data only goes into an account without any property, so nothing real is mixed with it.
	demo: async ({ locals }) => {
		requireOwner(locals);
		const result = await createDemoData(locals.db, auditContext(locals));
		if (!result.ok) {
			return fail(400, { demoError: 'Demodaten gibt es nur für ein leeres Konto.' });
		}
		redirect(303, '/');
	},
	// Deleting the account asks for the password again; that is the confirmation.
	delete: async ({ request, locals, cookies }) => {
		const user = requireOwner(locals);
		const result = parseDeleteAccount(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors });
		if ((await authenticate(locals.db, user.email, result.data.password)) !== user.id) {
			return fail(400, { errors: { password: 'Das Passwort stimmt nicht.' } });
		}
		// A running subscription ends first, so nobody keeps paying for a deleted account.
		if (!(await cancelSubscriptionOf(locals.db, user.accountId))) {
			return fail(502, {
				stripeError:
					'Stripe antwortet gerade nicht, darum ist dein Abo noch nicht gekündigt und dein Konto nicht gelöscht. Bitte versuche es gleich noch einmal.'
			});
		}
		// No storage given: the default adapter of the target deletes the documents' files.
		await deleteAccount(locals.db, user.accountId);
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/registrieren');
	}
};
