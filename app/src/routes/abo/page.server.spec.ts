import { isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { accounts } from '#lib/server/db/schema.ts';
import { managerA, outcome, ownerA, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const env = vi.hoisted(() => ({
	STRIPE_SECRET_KEY: 'sk_test_unit',
	STRIPE_PRICE_ID: 'price_unit',
	STRIPE_YEARLY_PRICE_ID: '',
	FREE_ACCOUNT_EMAILS: '',
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
/** The form bodies of the POSTs, in order. */
let sent: URLSearchParams[];

beforeEach(async () => {
	db = await testDatabase();
	calls = [];
	sent = [];
	answers = {};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const call = `${init.method} ${new URL(url).pathname}`;
			calls.push(call);
			if (init.method === 'POST') sent.push(new URLSearchParams(String(init.body ?? '')));
			const answer = answers[call]?.() ?? { status: 500, body: {} };
			return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	env.STRIPE_SECRET_KEY = 'sk_test_unit';
	env.ORIGIN = 'https://app.mietkartei.de';
	env.FREE_ACCOUNT_EMAILS = '';
	env.STRIPE_YEARLY_PRICE_ID = '';
});

function event(action: 'checkout' | 'portal', plan?: string) {
	const url = new URL(`https://app.mietkartei.de/abo?/${action}`);
	const body = plan ? new URLSearchParams({ plan }) : undefined;
	return {
		locals: {
			db,
			user: { id: 'user-a', email: 'a@example.org', accountId: 'a', name: null, role: 'owner' }
		},
		url,
		request: new Request(url, { method: 'POST', body })
	} as unknown as Parameters<(typeof actions)['checkout']>[0];
}

/** Runs an action and returns where it redirected, or the failure it answered with. */
async function run(action: 'checkout' | 'portal', plan?: string) {
	try {
		return { failure: await actions[action](event(action, plan)) };
	} catch (thrown) {
		if (isRedirect(thrown)) return { redirect: { status: thrown.status, to: thrown.location } };
		throw thrown;
	}
}

async function pending() {
	const [row] = await db.select().from(accounts).where(eq(accounts.id, 'a'));
	return row.stripeCheckoutSessionId;
}

function session(
	id: string,
	status: string,
	url: string | null,
	subscription?: string,
	priceId: string | null = 'price_unit'
) {
	return () => ({
		body: {
			id,
			object: 'checkout.session',
			status,
			url,
			subscription,
			metadata: priceId ? { priceId } : {}
		}
	});
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

	it('refuses a second subscription while one runs', async () => {
		await db
			.update(accounts)
			.set({ stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active' })
			.where(eq(accounts.id, 'a'));
		expect((await run('checkout')).failure).toMatchObject({
			status: 400,
			data: { message: 'Du hast bereits ein laufendes Abo.' }
		});
		expect(calls).toEqual([]);
	});

	it('refuses a free account, which needs no subscription', async () => {
		env.FREE_ACCOUNT_EMAILS = 'a@example.org';
		expect((await run('checkout')).failure).toMatchObject({
			status: 400,
			data: { message: 'Dein Konto ist kostenlos, du brauchst kein Abo.' }
		});
		expect(calls).toEqual([]);
	});

	it('does not send the owner to Stripe without a trusted origin', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		env.ORIGIN = '';
		expect((await run('checkout')).failure).toMatchObject({ status: 503 });
		expect(calls).toEqual([]);
	});

	it('reuses the stored customer', async () => {
		await db.update(accounts).set({ stripeCustomerId: 'cus_old' }).where(eq(accounts.id, 'a'));
		answers['POST /v1/checkout/sessions'] = session('cs_1', 'open', CHECKOUT_URL);
		await run('checkout');
		expect(calls).toEqual(['POST /v1/checkout/sessions']);
	});

	it('answers 502 when Stripe fails, also while looking up the stored session', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		answers['POST /v1/customers'] = () => ({ status: 500, body: {} });
		expect((await run('checkout')).failure).toMatchObject({ status: 502 });

		answers['POST /v1/customers'] = () => ({ body: { id: 'cus_a' } });
		await db.update(accounts).set({ stripeCheckoutSessionId: 'cs_1' }).where(eq(accounts.id, 'a'));
		answers['GET /v1/checkout/sessions/cs_1'] = () => ({ status: 500, body: {} });
		expect((await run('checkout')).failure).toMatchObject({ status: 502 });
		expect(calls).not.toContain('POST /v1/checkout/sessions');
	});

	it('is not there when the instance does not bill', async () => {
		env.STRIPE_SECRET_KEY = '';
		await expect(run('checkout')).rejects.toMatchObject({ status: 404 });
		await expect(run('portal')).rejects.toMatchObject({ status: 404 });
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

	it('answers 502 when Stripe fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect((await run('portal')).failure).toMatchObject({ status: 502 });
	});

	it('lets an unreachable network through as an error instead of hiding it', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('fetch failed');
			})
		);
		await expect(run('portal')).rejects.toThrow('fetch failed');
		await expect(run('checkout')).rejects.toThrow('fetch failed');
	});

	it('needs a customer and a trusted origin', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		env.ORIGIN = '';
		expect((await run('portal')).failure).toMatchObject({ status: 503 });
		await db.update(accounts).set({ stripeCustomerId: null }).where(eq(accounts.id, 'a'));
		expect((await run('portal')).failure).toMatchObject({
			status: 400,
			data: { message: 'Es gibt noch kein Abo.' }
		});
		expect(calls).toEqual([]);
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

	it('shows a free account without asking Stripe for the price', async () => {
		env.FREE_ACCOUNT_EMAILS = 'andere@example.org, A@example.org';
		expect(await show()).toMatchObject({ data: { state: 'free', price: null } });
		expect(calls).toEqual([]);
	});

	it('says monatlich for a price without a fixed amount', async () => {
		answers['GET /v1/prices/price_unit'] = () => ({
			body: { id: 'price_unit', unit_amount: null }
		});
		expect(await show()).toMatchObject({ data: { price: 'monatlich' } });
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

describe('plans', () => {
	beforeEach(() => {
		answers['POST /v1/customers'] = () => ({ body: { id: 'cus_a' } });
		answers['POST /v1/checkout/sessions'] = session('cs_1', 'open', CHECKOUT_URL);
		env.STRIPE_YEARLY_PRICE_ID = 'price_year';
	});

	/** The price of the last Checkout session opened. */
	function checkoutPrice() {
		const body = sent.findLast((params) => params.has('line_items[0][price]'));
		return body?.get('line_items[0][price]');
	}

	it('opens the yearly price for the yearly plan', async () => {
		await run('checkout', 'yearly');
		expect(checkoutPrice()).toBe('price_year');
	});

	it('opens the regular price for the monthly plan', async () => {
		await run('checkout', 'monthly');
		expect(checkoutPrice()).toBe('price_unit');
	});

	it('refuses the yearly plan where there is none', async () => {
		env.STRIPE_YEARLY_PRICE_ID = '';
		expect(await run('checkout', 'yearly')).toMatchObject({ failure: { status: 400 } });
		expect(calls).not.toContain('POST /v1/checkout/sessions');
	});

	it('does not reuse an open session that does not say its price', async () => {
		await db
			.update(accounts)
			.set({ stripeCheckoutSessionId: 'cs_old' })
			.where(eq(accounts.id, 'a'));
		answers['GET /v1/checkout/sessions/cs_old'] = session(
			'cs_old',
			'open',
			CHECKOUT_URL,
			undefined,
			null
		);
		answers['POST /v1/checkout/sessions/cs_old/expire'] = session('cs_old', 'expired', null);
		await run('checkout', 'yearly');
		expect(calls).toContain('POST /v1/checkout/sessions/cs_old/expire');
		expect(checkoutPrice()).toBe('price_year');
	});

	it('expires the open session of the other plan instead of reusing it', async () => {
		await run('checkout', 'monthly');
		answers['GET /v1/checkout/sessions/cs_1'] = () => ({
			body: {
				...session('cs_1', 'open', CHECKOUT_URL)().body,
				metadata: { priceId: 'price_unit' }
			}
		});
		answers['POST /v1/checkout/sessions/cs_1/expire'] = session('cs_1', 'expired', null);
		answers['POST /v1/checkout/sessions'] = session('cs_2', 'open', CHECKOUT_URL);
		await run('checkout', 'yearly');
		expect(calls).toContain('POST /v1/checkout/sessions/cs_1/expire');
		expect(checkoutPrice()).toBe('price_year');
		expect(await pending()).toBe('cs_2');
	});

	it('shows both plans', async () => {
		answers['GET /v1/prices/price_unit'] = () => ({
			body: { id: 'price_unit', unit_amount: 800, recurring: { interval: 'month' } }
		});
		answers['GET /v1/prices/price_year'] = () => ({
			body: { id: 'price_year', unit_amount: 7200, recurring: { interval: 'year' } }
		});
		const result = await outcome(() =>
			load(routeEvent(db, { url: 'https://app.mietkartei.de/abo', user: ownerA }))
		);
		expect(result).toMatchObject({
			data: {
				price: expect.stringMatching(/^8,00\s€ pro Monat$/),
				yearlyPrice: expect.stringMatching(/^72,00\s€ pro Jahr$/)
			}
		});
	});

	it('shows the price of the running subscription and offers no other plan', async () => {
		await db
			.update(accounts)
			.set({
				stripeSubscriptionId: 'sub_1',
				subscriptionStatus: 'active',
				stripePriceId: 'price_year',
				currentPeriodEnd: new Date('2027-10-01T00:00:00Z')
			})
			.where(eq(accounts.id, 'a'));
		answers['GET /v1/prices/price_year'] = () => ({
			body: { id: 'price_year', unit_amount: 7200, recurring: { interval: 'year' } }
		});
		const result = await outcome(() =>
			load(routeEvent(db, { url: 'https://app.mietkartei.de/abo', user: ownerA }))
		);
		expect(result).toMatchObject({
			data: { price: expect.stringMatching(/^72,00\s€ pro Jahr$/), yearlyPrice: null }
		});
	});

	it('reads the period from the plan when Stripe gives none, and words it when Stripe fails', async () => {
		answers['GET /v1/prices/price_unit'] = () => ({ status: 500, body: {} });
		answers['GET /v1/prices/price_year'] = () => ({
			body: { id: 'price_year', unit_amount: 7200 }
		});
		const result = await outcome(() =>
			load(routeEvent(db, { url: 'https://app.mietkartei.de/abo', user: ownerA }))
		);
		expect(result).toMatchObject({
			data: {
				price: 'monatlich',
				yearlyPrice: expect.stringMatching(/^72,00\s€ pro Jahr$/)
			}
		});

		answers['GET /v1/prices/price_year'] = () => ({ status: 500, body: {} });
		expect(
			await outcome(() =>
				load(routeEvent(db, { url: 'https://app.mietkartei.de/abo', user: ownerA }))
			)
		).toMatchObject({ data: { yearlyPrice: 'jährlich' } });
	});
});
