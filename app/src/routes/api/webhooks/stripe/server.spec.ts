import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { accounts } from '#lib/server/db/schema.ts';
import { signWebhookPayload } from '#lib/server/stripe.ts';
import { testDatabase } from '#lib/server/testing.ts';
import { POST } from './+server';

vi.mock('$app/env/private', () => ({
	STRIPE_SECRET_KEY: 'sk_test_unit',
	STRIPE_PRICE_ID: 'price_unit',
	STRIPE_WEBHOOK_SECRET: 'whsec_unit',
	STRIPE_API_BASE: 'http://stripe.test'
}));

let db: Database;
/** What GET /v1/subscriptions/sub_a answers: Stripe's current state of the subscription. */
let current: { status: string; current_period_end: number };

beforeEach(async () => {
	db = await testDatabase();
	await db
		.update(accounts)
		.set({ stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a' })
		.where(eq(accounts.id, 'a'));
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			expect(url).toBe('http://stripe.test/v1/subscriptions/sub_a');
			return new Response(JSON.stringify({ id: 'sub_a', customer: 'cus_a', ...current }));
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function deliver(id: string, type: string, status: string) {
	const payload = JSON.stringify({
		id,
		type,
		data: { object: { id: 'sub_a', customer: 'cus_a', status, current_period_end: 1_000 } }
	});
	const signature = await signWebhookPayload(payload, 'whsec_unit', Math.floor(Date.now() / 1000));
	const request = new Request('http://localhost/api/webhooks/stripe', {
		method: 'POST',
		body: payload,
		headers: { 'stripe-signature': signature }
	});
	const response = await POST({ request, locals: { db } } as unknown as Parameters<typeof POST>[0]);
	expect(response.status).toBe(200);
}

async function account(id: string) {
	const [row] = await db.select().from(accounts).where(eq(accounts.id, id));
	return row;
}

describe('POST /api/webhooks/stripe', () => {
	it('applies the subscription as Stripe has it now, not the payload of a late delivery', async () => {
		// 2030-01-15T00:00:00Z
		current = { status: 'canceled', current_period_end: 1_894_665_600 };
		await deliver('evt_deleted', 'customer.subscription.deleted', 'canceled');
		expect((await account('a')).subscriptionStatus).toBe('canceled');

		// An older "active" event arrives late (its first delivery failed). Stripe still says
		// canceled, so the account stays canceled.
		await deliver('evt_old', 'customer.subscription.updated', 'active');
		expect(await account('a')).toMatchObject({
			subscriptionStatus: 'canceled',
			currentPeriodEnd: new Date(1_894_665_600 * 1000)
		});
		// Does not leak into another account.
		expect((await account('b')).subscriptionStatus).toBe('none');
	});

	it('ends the pending Checkout with the completed session', async () => {
		await db.update(accounts).set({ stripeCheckoutSessionId: 'cs_1' }).where(eq(accounts.id, 'a'));
		current = { status: 'active', current_period_end: 1_894_665_600 };
		const object = { id: 'cs_1', mode: 'subscription', subscription: 'sub_a', customer: 'cus_a' };
		const payload = JSON.stringify({
			id: 'evt_completed',
			type: 'checkout.session.completed',
			data: { object }
		});
		const signature = await signWebhookPayload(
			payload,
			'whsec_unit',
			Math.floor(Date.now() / 1000)
		);
		const request = new Request('http://localhost/api/webhooks/stripe', {
			method: 'POST',
			body: payload,
			headers: { 'stripe-signature': signature }
		});
		const response = await POST({ request, locals: { db } } as unknown as Parameters<
			typeof POST
		>[0]);
		expect(response.status).toBe(200);
		expect(await account('a')).toMatchObject({
			subscriptionStatus: 'active',
			stripeCheckoutSessionId: null
		});
	});

	it('follows a change Stripe reports', async () => {
		current = { status: 'past_due', current_period_end: 1_894_665_600 };
		await deliver('evt_1', 'customer.subscription.updated', 'past_due');
		expect((await account('a')).subscriptionStatus).toBe('past_due');
		current = { status: 'active', current_period_end: 1_894_665_600 };
		// The payload is older than what the API answers; the API wins.
		await deliver('evt_2', 'customer.subscription.updated', 'past_due');
		expect((await account('a')).subscriptionStatus).toBe('active');
	});
});
