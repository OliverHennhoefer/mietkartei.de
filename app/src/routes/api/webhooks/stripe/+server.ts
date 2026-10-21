import { json, text } from '@sveltejs/kit';
import { STRIPE_WEBHOOK_SECRET } from '$app/env/private';
import {
	applySubscriptionUpdate,
	billingEnabled,
	recordStripeEvent,
	stripeEventSeen
} from '#lib/server/billing.ts';
import {
	getSubscription,
	subscriptionPeriodEnd,
	verifyWebhookSignature
} from '#lib/server/stripe.ts';
import type { RequestHandler } from './$types';

// Stripe tells us about the subscription here. The only POST without a session: the signature
// proves the sender, the stripe_events table makes a retried delivery a no-op. Subscription
// events are applied with the subscription as the API returns it now, never with the payload's
// copy, so late or reordered deliveries cannot bring back an old status. Every answer that is
// not a signature problem is 200, so Stripe stops retrying; only when the API cannot be reached
// the request fails, and Stripe delivers the event again later.

/** Stripe's events are a few kilobytes; anything far larger is not from Stripe. */
const MAX_PAYLOAD_BYTES = 512 * 1024;

type StripeEvent = {
	id: string;
	type: string;
	data?: { object?: Record<string, unknown> };
};

/** Stripe sends related objects as ids, or expanded as objects with an id. */
function idOf(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
		return (value as { id: string }).id;
	}
	return undefined;
}

/** The subscription an event is about; undefined for events that change nothing. */
function subscriptionNamedBy(type: string, object: Record<string, unknown>): string | undefined {
	switch (type) {
		case 'checkout.session.completed':
			return object.mode === 'subscription' ? idOf(object.subscription) : undefined;
		case 'customer.subscription.updated':
		case 'customer.subscription.deleted':
			return idOf(object.id);
		default:
			return undefined;
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!billingEnabled() || !STRIPE_WEBHOOK_SECRET)
		return text('Kein Abo konfiguriert.', { status: 404 });
	if (Number(request.headers.get('content-length') ?? 0) > MAX_PAYLOAD_BYTES) {
		return text('Zu groß.', { status: 413 });
	}
	const payload = await request.text();
	if (payload.length > MAX_PAYLOAD_BYTES) return text('Zu groß.', { status: 413 });
	const valid = await verifyWebhookSignature(
		payload,
		request.headers.get('stripe-signature'),
		STRIPE_WEBHOOK_SECRET,
		Math.floor(Date.now() / 1000)
	);
	if (!valid) return text('Ungültige Signatur.', { status: 400 });

	let event: StripeEvent;
	try {
		event = JSON.parse(payload) as StripeEvent;
	} catch {
		return text('Kein gültiges JSON.', { status: 400 });
	}
	if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
		return text('Kein Stripe-Ereignis.', { status: 400 });
	}

	const db = locals.db;
	if (await stripeEventSeen(db, event.id)) return json({ received: true, duplicate: true });
	const object = event.data?.object ?? {};

	// Stripe does not deliver events in order, and a retried delivery can be older than one
	// already applied. So an event only names the subscription; its current state comes from the
	// API, and applying it twice does no harm.
	const subscriptionId = subscriptionNamedBy(event.type, object);
	if (!subscriptionId) {
		await recordStripeEvent(db, event.id, event.type);
		return json({ received: true });
	}
	const subscription = await getSubscription(subscriptionId);
	const customerId = idOf(subscription.customer) ?? idOf(object.customer);
	const applied =
		customerId &&
		(await applySubscriptionUpdate(db, event, {
			customerId,
			subscriptionId: subscription.id,
			status: subscription.status,
			currentPeriodEnd: subscriptionPeriodEnd(subscription)
		}));
	if (!applied) await recordStripeEvent(db, event.id, event.type);
	return json({ received: true });
};
