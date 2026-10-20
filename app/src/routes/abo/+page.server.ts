import { error, fail, redirect } from '@sveltejs/kit';
import { BILLING_REQUIRED, STRIPE_PRICE_ID } from '$app/env/private';
import { formatCents } from '#lib/money.ts';
import {
	billingEnabled,
	billingState,
	dayOf,
	getBillingAccount,
	setStripeCustomer,
	trialDaysLeft,
	trialEnd
} from '#lib/server/billing.ts';
import { auditContext, requireOwner, requireUser } from '#lib/server/session.ts';
import {
	createCheckoutSession,
	createCustomer,
	createPortalSession,
	getPrice,
	StripeError
} from '#lib/server/stripe.ts';
import type { Actions, PageServerLoad } from './$types';

const STRIPE_DOWN = 'Stripe antwortet gerade nicht. Bitte versuche es gleich noch einmal.';

/** The monthly price as text, read from Stripe; "monatlich" when Stripe does not answer. */
async function priceText(): Promise<string> {
	try {
		const price = await getPrice(STRIPE_PRICE_ID);
		if (price.unit_amount !== null) return `${formatCents(price.unit_amount)} pro Monat`;
	} catch {
		// The page still works without the amount.
	}
	return 'monatlich';
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!billingEnabled()) error(404, 'Auf dieser Instanz gibt es kein Abo.');
	const user = requireUser(locals);
	if (user.role !== 'owner') return { owner: false as const };
	const account = await getBillingAccount(locals.db, user.accountId);
	if (!account) error(404, 'Dieses Konto gibt es nicht.');
	const now = new Date();
	return {
		owner: true as const,
		state: billingState(account, now),
		status: account.subscriptionStatus,
		trialEnd: dayOf(trialEnd(account)),
		trialDaysLeft: trialDaysLeft(account, now),
		currentPeriodEnd: account.currentPeriodEnd ? dayOf(account.currentPeriodEnd) : null,
		hasSubscription: Boolean(account.stripeSubscriptionId),
		required: BILLING_REQUIRED,
		price: await priceText(),
		success: url.searchParams.get('erfolg') === '1'
	};
};

export const actions: Actions = {
	/** Creates the Stripe customer when missing and sends the owner to Checkout. */
	checkout: async ({ locals, url }) => {
		if (!billingEnabled()) error(404, 'Auf dieser Instanz gibt es kein Abo.');
		const user = requireOwner(locals);
		const account = await getBillingAccount(locals.db, user.accountId);
		if (!account) error(404, 'Dieses Konto gibt es nicht.');
		let checkoutUrl: string;
		try {
			let customerId = account.stripeCustomerId;
			if (!customerId) {
				customerId = (await createCustomer(user.email, user.accountId)).id;
				await setStripeCustomer(locals.db, auditContext(locals), customerId);
			}
			// The rest of the free trial carries over; after it, the subscription starts at once.
			const trialDays =
				account.subscriptionStatus === 'none' ? trialDaysLeft(account, new Date()) : 0;
			const session = await createCheckoutSession({
				customerId,
				priceId: STRIPE_PRICE_ID,
				successUrl: `${url.origin}/abo?erfolg=1`,
				cancelUrl: `${url.origin}/abo`,
				trialDays
			});
			checkoutUrl = session.url;
		} catch (cause) {
			if (cause instanceof StripeError) {
				console.error(cause.message);
				return fail(502, { message: STRIPE_DOWN });
			}
			throw cause;
		}
		redirect(303, checkoutUrl);
	},

	/** Sends the owner to the Customer Portal (payment method, invoices, cancellation). */
	portal: async ({ locals, url }) => {
		if (!billingEnabled()) error(404, 'Auf dieser Instanz gibt es kein Abo.');
		const user = requireOwner(locals);
		const account = await getBillingAccount(locals.db, user.accountId);
		if (!account?.stripeCustomerId) return fail(400, { message: 'Es gibt noch kein Abo.' });
		let portalUrl: string;
		try {
			portalUrl = (await createPortalSession(account.stripeCustomerId, `${url.origin}/abo`)).url;
		} catch (cause) {
			if (cause instanceof StripeError) {
				console.error(cause.message);
				return fail(502, { message: STRIPE_DOWN });
			}
			throw cause;
		}
		redirect(303, portalUrl);
	}
};
