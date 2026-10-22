import { error, fail, redirect } from '@sveltejs/kit';
import { BILLING_REQUIRED, ORIGIN, STRIPE_PRICE_ID } from '$app/env/private';
import { dayOf } from '#lib/dates.ts';
import { formatCents } from '#lib/money.ts';
import {
	billingEnabled,
	billingState,
	getBillingAccount,
	replaceCheckoutSession,
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
	expireCheckoutSession,
	getCheckoutSession,
	getPrice,
	isStripeRedirect,
	STRIPE_REDIRECT_ORIGINS,
	StripeError,
	type StripeCheckoutSession
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

const SETTING_UP = 'Dein Abo wird gerade eingerichtet. Lade die Seite in einer Minute noch einmal.';

/**
 * Sends the browser to a URL Stripe answered with. Only Stripe's hosted pages and the app itself
 * are followed; anything else is answered like a failed call, so the page is never an open
 * redirect.
 */
function toStripe(location: string, origin: string) {
	if (!isStripeRedirect(location, origin)) {
		console.error(`Stripe answered with an unexpected redirect: ${location}`);
		return fail(502, { message: STRIPE_DOWN });
	}
	redirect(303, location, { external: STRIPE_REDIRECT_ORIGINS });
}

/** The pending Checkout session of the account; undefined when there is none or Stripe lost it. */
async function pendingCheckout(id: string | null): Promise<StripeCheckoutSession | undefined> {
	if (!id) return undefined;
	try {
		return await getCheckoutSession(id);
	} catch (cause) {
		if (cause instanceof StripeError && cause.status === 404) return undefined;
		throw cause;
	}
}

/** Stripe sends related objects as ids, or expanded as objects with an id. */
function idOf(value: string | { id: string } | null | undefined): string | undefined {
	return typeof value === 'string' ? value : (value?.id ?? undefined);
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
	/**
	 * Creates the Stripe customer when missing and sends the owner to Checkout. One Checkout
	 * session per account at a time: while the stored one is open it is reused, so two tabs or a
	 * double click cannot open two sessions that would both start a subscription.
	 */
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
			const pending = await pendingCheckout(account.stripeCheckoutSessionId);
			if (pending?.status === 'open' && pending.url) {
				checkoutUrl = pending.url;
			} else {
				// Completed, but its webhook has not arrived: the subscription exists already.
				// Once the webhook has stored it, the session is no longer pending.
				const completed =
					pending?.status === 'complete' &&
					idOf(pending.subscription) !== account.stripeSubscriptionId;
				if (completed) return fail(409, { message: SETTING_UP });
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
				const stored = await replaceCheckoutSession(
					locals.db,
					user.accountId,
					account.stripeCheckoutSessionId,
					session.id
				);
				if (!stored) {
					// Another request stored its session in the meantime; this one must not stay
					// open next to it.
					await expireCheckoutSession(session.id);
					return fail(409, {
						message: 'Der Checkout wurde gerade schon geöffnet. Bitte lade die Seite neu.'
					});
				}
				checkoutUrl = session.url;
			}
		} catch (cause) {
			if (cause instanceof StripeError) {
				console.error(cause.message);
				return fail(502, { message: STRIPE_DOWN });
			}
			throw cause;
		}
		return toStripe(checkoutUrl, origin);
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
		return toStripe(portalUrl, origin);
	}
};
