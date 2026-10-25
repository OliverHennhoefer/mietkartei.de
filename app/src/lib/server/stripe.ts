import { STRIPE_API_BASE, STRIPE_SECRET_KEY } from '$app/env/private';

// A minimal Stripe client over fetch: the few calls the subscription needs, form-encoded as
// Stripe expects, and the webhook signature check. No SDK, so the same code runs on node and on
// Workers. STRIPE_API_BASE points the end-to-end tests at a fake server (e2e/stripe-fake.ts).

/** Values of a request body; nested objects become `a[b]`, arrays `a[0]`, as Stripe wants. */
export type StripeParams = {
	[key: string]: string | number | boolean | null | undefined | StripeParams | StripeParams[];
};

export class StripeError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'StripeError';
	}
}

function flatten(params: StripeParams, prefix: string, into: URLSearchParams): void {
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null) continue;
		const name = prefix ? `${prefix}[${key}]` : key;
		if (Array.isArray(value)) {
			value.forEach((item, index) => flatten(item, `${name}[${index}]`, into));
		} else if (typeof value === 'object') {
			flatten(value, name, into);
		} else {
			into.append(name, String(value));
		}
	}
}

/** Encodes a body the way Stripe's API reads it: `subscription_data[trial_period_days]=14`. */
export function encodeForm(params: StripeParams): string {
	const into = new URLSearchParams();
	flatten(params, '', into);
	return into.toString();
}

/**
 * Calls the Stripe API. POST sends `params` form-encoded; GET and DELETE append them to the query.
 * Throws a StripeError with Stripe's message when the answer is not 2xx.
 */
export async function stripeRequest<T = Record<string, unknown>>(
	path: string,
	params: StripeParams = {},
	options: { method?: 'POST' | 'GET' | 'DELETE' } = {}
): Promise<T> {
	const method = options.method ?? 'POST';
	const base = STRIPE_API_BASE.replace(/\/$/, '');
	const body = encodeForm(params);
	const url = method !== 'POST' && body ? `${base}${path}?${body}` : `${base}${path}`;
	const response = await fetch(url, {
		method,
		headers: {
			authorization: `Bearer ${STRIPE_SECRET_KEY}`,
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: method === 'POST' ? body : undefined
	});
	const text = await response.text();
	let parsed: unknown;
	try {
		parsed = text ? JSON.parse(text) : {};
	} catch {
		parsed = {};
	}
	if (!response.ok) {
		const message =
			(parsed as { error?: { message?: string } }).error?.message ?? text ?? 'unknown error';
		throw new StripeError(response.status, `Stripe answered ${response.status}: ${message}`);
	}
	return parsed as T;
}

export type StripeSubscription = {
	id: string;
	status: string;
	customer: string;
	/** Unix seconds. Newer API versions carry it on the items instead. */
	current_period_end?: number;
	items?: { data?: { current_period_end?: number }[] };
};

export type StripePrice = {
	id: string;
	unit_amount: number | null;
	currency: string;
	recurring?: { interval?: string } | null;
};

export async function createCustomer(email: string, accountId: string): Promise<{ id: string }> {
	return stripeRequest<{ id: string }>('/v1/customers', {
		email,
		metadata: { accountId }
	});
}

/**
 * A Checkout session for the monthly subscription. `trialDays` (1 or more) carries the rest of
 * the app's trial into the subscription; without it the price's own trial settings apply.
 * Checkout offers a field for promotion codes, which Stripe checks against the coupons set up in
 * its dashboard (limits, expiry, first-time customers only); the app never sees a code.
 */
export async function createCheckoutSession(input: {
	customerId: string;
	priceId: string;
	successUrl: string;
	cancelUrl: string;
	trialDays?: number;
}): Promise<{ id: string; url: string }> {
	const trial =
		input.trialDays !== undefined && input.trialDays >= 1
			? { subscription_data: { trial_period_days: Math.ceil(input.trialDays) } }
			: {};
	return stripeRequest<{ id: string; url: string }>('/v1/checkout/sessions', {
		mode: 'subscription',
		customer: input.customerId,
		line_items: [{ price: input.priceId, quantity: 1 }],
		success_url: input.successUrl,
		cancel_url: input.cancelUrl,
		allow_promotion_codes: true,
		...trial
	});
}

export type StripeCheckoutSession = {
	id: string;
	/** `open` until it is completed or expires (after 24 hours, or when expired through the API). */
	status: 'open' | 'complete' | 'expired' | null;
	/** Only while the session is open. */
	url: string | null;
	subscription?: string | { id: string } | null;
};

export async function getCheckoutSession(id: string): Promise<StripeCheckoutSession> {
	return stripeRequest<StripeCheckoutSession>(
		`/v1/checkout/sessions/${encodeURIComponent(id)}`,
		{},
		{ method: 'GET' }
	);
}

/** Expires an open Checkout session, so it can no longer be completed. */
export async function expireCheckoutSession(id: string): Promise<StripeCheckoutSession> {
	return stripeRequest<StripeCheckoutSession>(
		`/v1/checkout/sessions/${encodeURIComponent(id)}/expire`
	);
}

/** Where Stripe sends the owner: the hosted Checkout page and the Customer Portal. */
export const STRIPE_REDIRECT_ORIGINS = [
	'https://checkout.stripe.com',
	'https://billing.stripe.com'
];

/**
 * Whether a URL Stripe answered with may be redirected to: one of STRIPE_REDIRECT_ORIGINS, or the
 * app's own origin (where the end-to-end fake sends the browser). Anything else would make the
 * subscription page an open redirect for whoever controls the answer.
 */
export function isStripeRedirect(location: string, appOrigin: string): boolean {
	let url: URL;
	try {
		url = new URL(location);
	} catch {
		return false;
	}
	return url.origin === appOrigin || STRIPE_REDIRECT_ORIGINS.includes(url.origin);
}

export async function createPortalSession(
	customerId: string,
	returnUrl: string
): Promise<{ url: string }> {
	return stripeRequest<{ url: string }>('/v1/billing_portal/sessions', {
		customer: customerId,
		return_url: returnUrl
	});
}

export async function getSubscription(id: string): Promise<StripeSubscription> {
	return stripeRequest<StripeSubscription>(
		`/v1/subscriptions/${encodeURIComponent(id)}`,
		{},
		{
			method: 'GET'
		}
	);
}

/**
 * The subscriptions of a customer that are not canceled yet (Stripe's default without `status`).
 * One customer has one or two, so the first page of 100 holds all of them.
 */
export async function listSubscriptions(customerId: string): Promise<StripeSubscription[]> {
	const page = await stripeRequest<{ data: StripeSubscription[] }>(
		'/v1/subscriptions',
		{ customer: customerId, limit: 100 },
		{ method: 'GET' }
	);
	return page.data;
}

/** Cancels a subscription at once (no further invoices); Stripe answers with the canceled object. */
export async function cancelSubscription(id: string): Promise<StripeSubscription> {
	return stripeRequest<StripeSubscription>(
		`/v1/subscriptions/${encodeURIComponent(id)}`,
		{},
		{ method: 'DELETE' }
	);
}

export async function getPrice(id: string): Promise<StripePrice> {
	return stripeRequest<StripePrice>(`/v1/prices/${encodeURIComponent(id)}`, {}, { method: 'GET' });
}

/** The period end of a subscription as a Date, wherever the API version puts it. */
export function subscriptionPeriodEnd(subscription: StripeSubscription): Date | null {
	const seconds =
		subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
	return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

// Webhook signatures: the header is `t=<unix seconds>,v1=<hex hmac>[,v1=…]`, the signed payload
// is `<t>.<raw body>`, the key is the endpoint's signing secret.

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
	return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
		''
	);
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let index = 0; index < a.length; index += 1) {
		difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}
	return difference === 0;
}

/** Builds a Stripe-Signature header, for tests and the fake server. */
export async function signWebhookPayload(
	payload: string,
	secret: string,
	timestamp: number
): Promise<string> {
	return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${payload}`)}`;
}

/** The tolerance Stripe recommends against replayed deliveries. */
const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Checks a Stripe-Signature header against the raw body. `now` is in unix seconds; a timestamp
 * more than five minutes away from it is refused.
 */
export async function verifyWebhookSignature(
	payload: string,
	header: string | null,
	secret: string,
	now: number
): Promise<boolean> {
	if (!header || !secret) return false;
	let timestamp: number | undefined;
	const signatures: string[] = [];
	for (const part of header.split(',')) {
		const [key, value] = part.split('=', 2).map((item) => item.trim());
		if (key === 't' && value && /^\d+$/.test(value)) timestamp = Number(value);
		else if (key === 'v1' && value) signatures.push(value);
	}
	if (timestamp === undefined || signatures.length === 0) return false;
	if (Math.abs(now - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
	const expected = await hmacHex(secret, `${timestamp}.${payload}`);
	// Every candidate is compared, so timing does not reveal which one matched.
	let valid = false;
	for (const signature of signatures) {
		if (constantTimeEqual(signature, expected)) valid = true;
	}
	return valid;
}
