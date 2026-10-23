import { isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { accounts } from '#lib/server/db/schema.ts';
import { managerA, outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const env = vi.hoisted(() => ({
	STRIPE_SECRET_KEY: 'sk_test_unit',
	STRIPE_PRICE_ID: 'price_unit',
	STRIPE_WEBHOOK_SECRET: 'whsec_unit',
	STRIPE_API_BASE: 'http://stripe.test',
	BILLING_REQUIRED: false,
	ORIGIN: 'https://app.mietkartei.de'
}));
vi.mock('$app/env/private', () => env);

// The URLs real Stripe answers with; the end-to-end fake answers with the app's own URLs, so
// only these tests see a redirect to another origin.
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_a1#fidkdWxOYHwnPyd1blpxYHZxWjA0';
const PORTAL_URL = 'https://billing.stripe.com/p/session/test_YWNjdF8xTjM';

let db: Database;
/** Answers by "METHOD path"; every call is recorded the same way. */
let answers: Record<string, () => { status?: number; body: unknown }>;
let calls: string[];

beforeEach(async () => {
	db = await testDatabase();
	calls = [];
	answers = {};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const call = `${init.method} ${new URL(url).pathname}`;
			calls.push(call);
			const answer = answers[call]?.() ?? { status: 500, body: {} };
			return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	env.STRIPE_SECRET_KEY = 'sk_test_unit';
});

function event(action: 'checkout' | 'portal') {
	const url = new URL(`https://app.mietkartei.de/abo?/${action}`);
	return {
		locals: {
			db,
			user: { id: 'user-a', email: 'a@example.org', accountId: 'a', name: null, role: 'owner' }
		},
		url,
		request: new Request(url, { method: 'POST' })
	} as unknown as Parameters<(typeof actions)['checkout']>[0];
}

/** Runs an action and returns where it redirected, or the failure it answered with. */
async function run(action: 'checkout' | 'portal') {
	try {
		return { failure: await actions[action](event(action)) };
	} catch (thrown) {
		if (isRedirect(thrown)) return { redirect: { status: thrown.status, to: thrown.location } };
		throw thrown;
	}
}

async function pending() {
	const [row] = await db.select().from(accounts).where(eq(accounts.id, 'a'));
	return row.stripeCheckoutSessionId;
}

function session(id: string, status: string, url: string | null, subscription?: string) {
	return () => ({ body: { id, object: 'checkout.session', status, url, subscription } });
}

describe('checkout', () => {
	beforeEach(() => {
		answers['POST /v1/customers'] = () => ({ body: { id: 'cus_a' } });
	});

	it('redirects to the Checkout page on checkout.stripe.com and keeps the session', async () => {
		answers['POST /v1/checkout/sessions'] = session('cs_1', 'open', CHECKOUT_URL);
		expect(await run('checkout')).toEqual({ redirect: { status: 303, to: CHECKOUT_URL } });
		expect(await pending()).toBe('cs_1');
	});

	it('reuses the open session instead of opening a second one', async () => {
		answers['POST /v1/checkout/sessions'] = session('cs_1', 'open', CHECKOUT_URL);
		answers['GET /v1/checkout/sessions/cs_1'] = session('cs_1', 'open', CHECKOUT_URL);
		await run('checkout');
		expect(await run('checkout')).toEqual({ redirect: { status: 303, to: CHECKOUT_URL } });
		expect(calls.filter((call) => call === 'POST /v1/checkout/sessions')).toHaveLength(1);
		expect(calls).toContain('GET /v1/checkout/sessions/cs_1');
	});

	it('opens a new session once the stored one has expired or is unknown to Stripe', async () => {
		await db
			.update(accounts)
			.set({ stripeCheckoutSessionId: 'cs_old' })
			.where(eq(accounts.id, 'a'));
		answers['GET /v1/checkout/sessions/cs_old'] = session('cs_old', 'expired', null);
		answers['POST /v1/checkout/sessions'] = session('cs_new', 'open', CHECKOUT_URL);
		expect(await run('checkout')).toEqual({ redirect: { status: 303, to: CHECKOUT_URL } });
		expect(await pending()).toBe('cs_new');

		answers['GET /v1/checkout/sessions/cs_new'] = () => ({ status: 404, body: {} });
		answers['POST /v1/checkout/sessions'] = session('cs_next', 'open', CHECKOUT_URL);
		await run('checkout');
		expect(await pending()).toBe('cs_next');
	});

	it('refuses while a completed session waits for its webhook', async () => {
		await db.update(accounts).set({ stripeCheckoutSessionId: 'cs_1' }).where(eq(accounts.id, 'a'));
		answers['GET /v1/checkout/sessions/cs_1'] = session('cs_1', 'complete', null, 'sub_new');
		const { failure } = await run('checkout');
		expect(failure).toMatchObject({ status: 409 });
		expect(calls).not.toContain('POST /v1/checkout/sessions');
	});

	it('opens a new one after the subscription of a completed session has ended', async () => {
		await db
			.update(accounts)
			.set({
				stripeCheckoutSessionId: 'cs_1',
				stripeSubscriptionId: 'sub_1',
				subscriptionStatus: 'canceled'
			})
			.where(eq(accounts.id, 'a'));
		answers['GET /v1/checkout/sessions/cs_1'] = session('cs_1', 'complete', null, 'sub_1');
		answers['POST /v1/checkout/sessions'] = session('cs_2', 'open', CHECKOUT_URL);
		expect(await run('checkout')).toEqual({ redirect: { status: 303, to: CHECKOUT_URL } });
		expect(await pending()).toBe('cs_2');
	});

	it('expires its own session when another request stored one first', async () => {
		answers['POST /v1/checkout/sessions'] = () => {
			// The other request finishes while this one waits for Stripe.
			db.update(accounts)
				.set({ stripeCheckoutSessionId: 'cs_other' })
				.where(eq(accounts.id, 'a'))
				.run();
			return session('cs_mine', 'open', CHECKOUT_URL)();
		};
		answers['POST /v1/checkout/sessions/cs_mine/expire'] = session('cs_mine', 'expired', null);
		const { failure } = await run('checkout');
		expect(failure).toMatchObject({ status: 409 });
		expect(calls).toContain('POST /v1/checkout/sessions/cs_mine/expire');
		expect(await pending()).toBe('cs_other');
	});

	it('answers 502 instead of redirecting anywhere but Stripe', async () => {
		answers['POST /v1/checkout/sessions'] = session('cs_1', 'open', 'https://evil.example/pay');
		const { failure } = await run('checkout');
		expect(failure).toMatchObject({ status: 502 });
	});
});

describe('portal', () => {
	beforeEach(async () => {
		await db.update(accounts).set({ stripeCustomerId: 'cus_a' }).where(eq(accounts.id, 'a'));
	});

	it('redirects to the Customer Portal on billing.stripe.com', async () => {
		answers['POST /v1/billing_portal/sessions'] = () => ({ body: { url: PORTAL_URL } });
		expect(await run('portal')).toEqual({ redirect: { status: 303, to: PORTAL_URL } });
	});

	it('answers 502 for a URL on another host', async () => {
		answers['POST /v1/billing_portal/sessions'] = () => ({
			body: { url: 'https://billing.stripe.com.evil.example/p' }
		});
		expect((await run('portal')).failure).toMatchObject({ status: 502 });
	});
});

describe('load', () => {
	const show = (url = '/abo', user = undefined as typeof managerA | undefined) =>
		outcome(() => load(routeEvent(db, { url, user })));

	it('is not there when the instance does not bill', async () => {
		env.STRIPE_SECRET_KEY = '';
		expect(await show()).toMatchObject({ error: 404 });
	});

	it('shows a manager only that the owner handles the subscription', async () => {
		expect(await show('/abo', managerA)).toEqual({ data: { owner: false } });
	});

	it('shows the owner the trial and the price Stripe answers with', async () => {
		answers['GET /v1/prices/price_unit'] = () => ({ body: { id: 'price_unit', unit_amount: 900 } });
		const { data } = (await show('/abo?erfolg=1')) as { data: Record<string, unknown> };
		expect(data).toMatchObject({
			owner: true,
			state: 'trialing',
			status: 'none',
			currentPeriodEnd: null,
			hasSubscription: false,
			required: false,
			price: expect.stringMatching(/^9,00\s€ pro Monat$/),
			success: true
		});
		expect(data.trialEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('still opens when Stripe does not answer with a price', async () => {
		await db
			.update(accounts)
			.set({ stripeSubscriptionId: 'sub_1', currentPeriodEnd: new Date('2026-11-01T00:00:00Z') })
			.where(eq(accounts.id, 'a'));
		const { data } = (await show()) as { data: Record<string, unknown> };
		expect(data).toMatchObject({
			price: 'monatlich',
			success: false,
			hasSubscription: true,
			currentPeriodEnd: '2026-11-01'
		});
	});
});
