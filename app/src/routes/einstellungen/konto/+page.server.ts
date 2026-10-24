import { fail, redirect } from '@sveltejs/kit';
import {
	confirmPasswordError,
	parseDeleteAccount,
	parseResetAccount,
	type ResetAccountInput
} from '#lib/forms/auth.ts';
import { deleteAccount, resetAccount } from '#lib/server/accounts.ts';
import { confirmPassword } from '#lib/server/auth.ts';
import {
	billingEnabled,
	cancelSubscriptionOf,
	getBillingAccount,
	subscriptionRuns
} from '#lib/server/billing.ts';
import { createDemoData, isEmptyAccount } from '#lib/server/demo.ts';
import { accessEndedMail, leaveAccount, listAccountUsers } from '#lib/server/invitations.ts';
import { sendMailInBackground } from '#lib/server/mail.ts';
import {
	auditContext,
	deleteSessionCookie,
	requireOwner,
	requireUser
} from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * Leaving and deleting the account ask for the password again; that is the confirmation. Wrong
 * passwords count like failed sign-ins, so a stolen session cannot guess it. Returns the failure
 * to answer with, or undefined when the password is right.
 */
async function refusePassword(locals: App.Locals, form: FormData) {
	const result = parseDeleteAccount(form);
	if (!result.ok) return fail(400, { errors: result.errors });
	const checked = await confirmPassword(locals.db, auditContext(locals), result.data.password);
	if (checked !== 'ok') return fail(400, { errors: { password: confirmPasswordError(checked) } });
}

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
			return fail(400, { demoFailed: 'Demodaten gibt es nur für ein leeres Konto.' });
		}
		redirect(303, '/');
	},
	// Managers and viewers end their own access.
	leave: async (event) => {
		const { request, locals } = event;
		requireUser(locals);
		const refused = await refusePassword(locals, await request.formData());
		if (refused) return refused;
		if ((await leaveAccount(locals.db, auditContext(locals))) !== 'left') {
			return fail(400, {
				failed: 'Als Vermieter kannst du das Konto nicht verlassen, nur löschen oder übergeben.'
			});
		}
		deleteSessionCookie(event);
		redirect(303, '/anmelden');
	},
	// The reset deletes all data but keeps the account, its users and the subscription. The typed
	// word and the password again are the confirmation; errors carry their own keys, because the
	// deletion form on the same page has a password field too.
	reset: async ({ request, locals }) => {
		requireOwner(locals);
		const result = parseResetAccount(await request.formData());
		if (!result.ok) return fail(400, { resetErrors: result.errors });
		const context = auditContext(locals);
		const checked = await confirmPassword(locals.db, context, result.data.password);
		if (checked !== 'ok') {
			const resetErrors: Partial<Record<keyof ResetAccountInput, string>> = {
				password: confirmPasswordError(checked)
			};
			return fail(400, { resetErrors });
		}
		// No storage given: the default adapter of the target deletes the documents' files. A
		// failure leaves the data (or at least most of it) in place, so the owner can try again.
		try {
			await resetAccount(locals.db, context);
		} catch (error) {
			console.error('[account] The account was not reset:', error);
			return fail(503, {
				resetFailed: 'Das Konto konnte nicht zurückgesetzt werden. Bitte versuche es erneut.'
			});
		}
		redirect(303, '/');
	},
	delete: async (event) => {
		const { request, locals } = event;
		const user = requireOwner(locals);
		const refused = await refusePassword(locals, await request.formData());
		if (refused) return refused;
		// A running subscription ends first, so nobody keeps paying for a deleted account.
		if (!(await cancelSubscriptionOf(locals.db, user.accountId))) {
			return fail(502, {
				failed:
					'Stripe antwortet gerade nicht, darum ist dein Abo noch nicht gekündigt und dein Konto nicht gelöscht. Bitte versuche es gleich noch einmal.'
			});
		}
		const others = (await listAccountUsers(locals.db, user.accountId)).filter(
			(member) => member.id !== user.id
		);
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
		// The others learn why they cannot sign in any more.
		for (const member of others) {
			await sendMailInBackground(locals.db, accessEndedMail(member.email, 'account-deleted'));
		}
		deleteSessionCookie(event);
		redirect(303, '/anmelden');
	}
};
