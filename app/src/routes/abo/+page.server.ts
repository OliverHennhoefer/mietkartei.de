import { error, fail, redirect } from '@sveltejs/kit';
import { BILLING_REQUIRED, ORIGIN, STRIPE_PRICE_ID } from '$app/env/private';
import { dayOf } from '#lib/dates.ts';
import { formatCents } from '#lib/money.ts';
import {
	billingEnabled,
	billingState,
	getBillingAccount,
	setStripeCustomer,
	subscriptionRuns,
	trialDaysLeft,
	trialEnd
} from '#lib/server/billing.ts';
import { mailLinkOrigin } from '#lib/server/mail-links.ts';
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

const NO_ORIGIN =
	'Das Abo ist hier noch nicht eingerichtet: Wer mietkartei betreibt, muss dafür ORIGIN auf die öffentliche Adresse setzen.';

/**
 * The origin Stripe sends the owner back to. Like a link in a mail it must not follow a Host
 * header the request chose, so the same rules apply; undefined when there is no trusted one.
 */
function returnOrigin(url: URL): string | undefined {
	const origin = mailLinkOrigin(url, ORIGIN, __DEPLOY_TARGET__);
	if (!origin) console.warn('Stripe redirect refused: set ORIGIN to the public URL of mietkartei.');
	return origin;
}

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
		// A second Checkout would start a second subscription that bills at once.
		if (subscriptionRuns(account))
			return fail(400, { message: 'Du hast bereits ein laufendes Abo.' });
		const origin = returnOrigin(url);
		if (!origin) return fail(503, { message: NO_ORIGIN });
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
				successUrl: `${origin}/abo?erfolg=1`,
				cancelUrl: `${origin}/abo`,
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
		const origin = returnOrigin(url);
		if (!origin) return fail(503, { message: NO_ORIGIN });
		let portalUrl: string;
		try {
			portalUrl = (await createPortalSession(account.stripeCustomerId, `${origin}/abo`)).url;
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
