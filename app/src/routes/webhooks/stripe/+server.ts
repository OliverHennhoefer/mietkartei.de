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
// proves the sender, the stripe_events table makes a retried delivery a no-op. Every answer that
// is not a signature problem is 200, so Stripe stops retrying.

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

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!billingEnabled() || !STRIPE_WEBHOOK_SECRET)
		return text('Kein Abo konfiguriert.', { status: 404 });
	const payload = await request.text();
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

	switch (event.type) {
		case 'checkout.session.completed': {
			const subscriptionId = idOf(object.subscription);
			if (object.mode !== 'subscription' || !subscriptionId) {
				await recordStripeEvent(db, event.id, event.type);
				break;
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
			break;
		}
		case 'customer.subscription.updated':
		case 'customer.subscription.deleted': {
			const customerId = idOf(object.customer);
			const subscriptionId = idOf(object.id);
			const applied =
				customerId &&
				subscriptionId &&
				typeof object.status === 'string' &&
				(await applySubscriptionUpdate(db, event, {
					customerId,
					subscriptionId,
					status: object.status,
					currentPeriodEnd: subscriptionPeriodEnd({
						id: subscriptionId,
						status: object.status,
						customer: customerId,
						current_period_end:
							typeof object.current_period_end === 'number' ? object.current_period_end : undefined,
						items: object.items as { data?: { current_period_end?: number }[] } | undefined
					})
				}));
			if (!applied) await recordStripeEvent(db, event.id, event.type);
			break;
		}
		default:
			await recordStripeEvent(db, event.id, event.type);
	}
	return json({ received: true });
};
