import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createCheckoutSession,
	encodeForm,
	getSubscription,
	isStripeRedirect,
	signWebhookPayload,
	StripeError,
	stripeRequest,
	subscriptionPeriodEnd,
	verifyWebhookSignature
} from './stripe';

vi.mock('$app/env/private', () => ({
	STRIPE_SECRET_KEY: 'sk_test_unit',
	STRIPE_API_BASE: 'http://stripe.test'
}));

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown) {
	const calls: Call[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
	return calls;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('encodeForm', () => {
	it('flattens nested objects and arrays into bracket notation', () => {
		const encoded = encodeForm({
			mode: 'subscription',
			line_items: [{ price: 'price_1', quantity: 1 }],
			subscription_data: { trial_period_days: 14 },
			metadata: { accountId: 'a' },
			skipped: undefined,
			alsoSkipped: null
		});
		expect(encoded.split('&').sort()).toEqual(
			[
				'mode=subscription',
				'line_items%5B0%5D%5Bprice%5D=price_1',
				'line_items%5B0%5D%5Bquantity%5D=1',
				'subscription_data%5Btrial_period_days%5D=14',
				'metadata%5BaccountId%5D=a'
			].sort()
		);
		expect(decodeURIComponent(encoded)).toContain('line_items[0][price]=price_1');
	});

	it('escapes values the way a form does', () => {
		expect(encodeForm({ success_url: 'http://x/abo?erfolg=1', email: 'a+b@example.org' })).toBe(
			'success_url=http%3A%2F%2Fx%2Fabo%3Ferfolg%3D1&email=a%2Bb%40example.org'
		);
	});
});

describe('stripeRequest', () => {
	it('posts a form-encoded body with the secret key as bearer token', async () => {
		const calls = fakeFetch(200, { id: 'cus_1' });
		const result = await stripeRequest('/v1/customers', { email: 'a@example.org' });
		expect(result).toEqual({ id: 'cus_1' });
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('http://stripe.test/v1/customers');
		expect(calls[0].init.method).toBe('POST');
		expect(calls[0].init.body).toBe('email=a%40example.org');
		const headers = calls[0].init.headers as Record<string, string>;
		expect(headers.authorization).toBe('Bearer sk_test_unit');
		expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
	});

	it('sends GET parameters in the query and no body', async () => {
		const calls = fakeFetch(200, { id: 'sub_1', status: 'active', customer: 'cus_1' });
		await getSubscription('sub_1');
		expect(calls[0].url).toBe('http://stripe.test/v1/subscriptions/sub_1');
		expect(calls[0].init.method).toBe('GET');
		expect(calls[0].init.body).toBeUndefined();
	});

	it('throws a StripeError with the message of an error answer', async () => {
		fakeFetch(402, { error: { message: 'Your card was declined.' } });
		await expect(stripeRequest('/v1/charges', {})).rejects.toThrow(StripeError);
		await expect(stripeRequest('/v1/charges', {})).rejects.toThrow('Your card was declined.');
	});

	it('names the plain text of an answer that is not JSON', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('Bad Gateway', { status: 502 }))
		);
		await expect(stripeRequest('/v1/charges', {})).rejects.toThrow(
			'Stripe answered 502: Bad Gateway'
		);
	});

	it('builds a subscription checkout with the remaining trial days', async () => {
		const calls = fakeFetch(200, { id: 'cs_1', url: 'http://stripe.test/pay' });
		const session = await createCheckoutSession({
			customerId: 'cus_1',
			priceId: 'price_1',
			successUrl: 'http://app/abo?erfolg=1',
			cancelUrl: 'http://app/abo',
			trialDays: 12.4
		});
		expect(session.url).toBe('http://stripe.test/pay');
		const body = new URLSearchParams(String(calls[0].init.body));
		expect(body.get('mode')).toBe('subscription');
		expect(body.get('customer')).toBe('cus_1');
		expect(body.get('line_items[0][price]')).toBe('price_1');
		expect(body.get('line_items[0][quantity]')).toBe('1');
		expect(body.get('success_url')).toBe('http://app/abo?erfolg=1');
		expect(body.get('subscription_data[trial_period_days]')).toBe('13');
		expect(body.get('allow_promotion_codes')).toBe('true');
	});

	it('leaves the trial to the price when no days remain', async () => {
		const calls = fakeFetch(200, { id: 'cs_1', url: 'u' });
		await createCheckoutSession({
			customerId: 'cus_1',
			priceId: 'price_1',
			successUrl: 's',
			cancelUrl: 'c',
			trialDays: 0
		});
		expect(String(calls[0].init.body)).not.toContain('trial_period_days');
	});
});

describe('isStripeRedirect', () => {
	const app = 'https://app.mietkartei.de';

	it('accepts the hosted Checkout page, the Customer Portal and the app itself', () => {
		expect(isStripeRedirect('https://checkout.stripe.com/c/pay/cs_test_a1b2#fid', app)).toBe(true);
		expect(isStripeRedirect('https://billing.stripe.com/p/session/test_YWNjdA', app)).toBe(true);
		expect(isStripeRedirect('https://app.mietkartei.de/abo?erfolg=1', app)).toBe(true);
	});

	it('refuses every other host, scheme and relative or broken URL', () => {
		expect(isStripeRedirect('https://evil.example/c/pay/cs_test', app)).toBe(false);
		expect(isStripeRedirect('http://checkout.stripe.com/c/pay/cs_test', app)).toBe(false);
		expect(isStripeRedirect('https://checkout.stripe.com.evil.example/', app)).toBe(false);
		expect(isStripeRedirect('https://stripe.com/', app)).toBe(false);
		expect(isStripeRedirect('javascript:alert(1)', app)).toBe(false);
		expect(isStripeRedirect('/abo', app)).toBe(false);
		expect(isStripeRedirect('', app)).toBe(false);
	});
});

describe('subscriptionPeriodEnd', () => {
	it('reads the seconds from the subscription or from its first item', () => {
		// 1_800_000_000 s = 2027-01-15T08:00:00Z.
		expect(
			subscriptionPeriodEnd({
				id: 's',
				status: 'active',
				customer: 'c',
				current_period_end: 1_800_000_000
			})
		).toEqual(new Date('2027-01-15T08:00:00.000Z'));
		expect(
			subscriptionPeriodEnd({
				id: 's',
				status: 'active',
				customer: 'c',
				items: { data: [{ current_period_end: 1_800_000_000 }] }
			})
		).toEqual(new Date('2027-01-15T08:00:00.000Z'));
		expect(subscriptionPeriodEnd({ id: 's', status: 'active', customer: 'c' })).toBeNull();
	});
});

describe('verifyWebhookSignature', () => {
	const secret = 'whsec_unit_test_secret';
	const payload = '{"id":"evt_1","type":"customer.subscription.updated"}';
	const timestamp = 1_760_000_000;
	// The reference value is computed independently with node:crypto.
	const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

	it('accepts the signature Stripe would send', async () => {
		const header = `t=${timestamp},v1=${expected}`;
		expect(await verifyWebhookSignature(payload, header, secret, timestamp + 10)).toBe(true);
		expect(await signWebhookPayload(payload, secret, timestamp)).toBe(header);
	});

	it('accepts a header with several v1 entries when one matches', async () => {
		const header = `t=${timestamp},v1=${'0'.repeat(64)},v1=${expected}`;
		expect(await verifyWebhookSignature(payload, header, secret, timestamp)).toBe(true);
	});

	it('refuses a wrong secret, a changed payload and a missing header', async () => {
		const header = `t=${timestamp},v1=${expected}`;
		expect(await verifyWebhookSignature(payload, header, 'whsec_other', timestamp)).toBe(false);
		expect(await verifyWebhookSignature(payload + ' ', header, secret, timestamp)).toBe(false);
		expect(await verifyWebhookSignature(payload, null, secret, timestamp)).toBe(false);
		expect(await verifyWebhookSignature(payload, 'v1=abc', secret, timestamp)).toBe(false);
		expect(await verifyWebhookSignature(payload, header, '', timestamp)).toBe(false);
		// A malformed timestamp or an empty v1 entry counts as missing.
		expect(await verifyWebhookSignature(payload, `t=soon,v1=${expected}`, secret, timestamp)).toBe(
			false
		);
		expect(await verifyWebhookSignature(payload, `t=${timestamp},v1=`, secret, timestamp)).toBe(
			false
		);
		expect(await verifyWebhookSignature(payload, `t=${timestamp},v1=abc`, secret, timestamp)).toBe(
			false
		);
	});

	it('refuses timestamps outside the five-minute tolerance', async () => {
		const header = `t=${timestamp},v1=${expected}`;
		expect(await verifyWebhookSignature(payload, header, secret, timestamp + 300)).toBe(true);
		expect(await verifyWebhookSignature(payload, header, secret, timestamp + 301)).toBe(false);
		expect(await verifyWebhookSignature(payload, header, secret, timestamp - 301)).toBe(false);
	});
});
