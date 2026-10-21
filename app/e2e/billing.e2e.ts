import { expect, test, type APIRequestContext } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';
import {
	FAKE_CUSTOMER_ID,
	FAKE_PERIOD_END,
	FAKE_SUBSCRIPTION_ID,
	requests,
	start,
	stop
} from './stripe-fake';

// The web server runs with STRIPE_SECRET_KEY=sk_test_fake, STRIPE_PRICE_ID=price_fake,
// STRIPE_WEBHOOK_SECRET=whsec_fake and STRIPE_API_BASE pointing at e2e/stripe-fake.ts.
const WEBHOOK_SECRET = 'whsec_fake';

test.beforeAll(async () => {
	await start();
});

test.afterAll(async () => {
	await stop();
});

/** Posts a Stripe event the way Stripe does: raw JSON with a signed Stripe-Signature header. */
async function postEvent(
	request: APIRequestContext,
	event: { id: string; type: string; data: { object: Record<string, unknown> } },
	options: { secret?: string; timestamp?: number } = {}
) {
	const payload = JSON.stringify({ object: 'event', ...event });
	const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
	const signature = createHmac('sha256', options.secret ?? WEBHOOK_SECRET)
		.update(`${timestamp}.${payload}`)
		.digest('hex');
	return request.post('/webhooks/stripe', {
		data: payload,
		headers: {
			'content-type': 'application/json',
			'stripe-signature': `t=${timestamp},v1=${signature}`
		}
	});
}

function eventId(): string {
	return `evt_${randomUUID().replaceAll('-', '')}`;
}

test('shows the trial, subscribes through Checkout and follows the webhooks', async ({ page }) => {
	// A fresh account is in its 30-day trial: the page and the notice above every page say so.
	await page.goto('/abo');
	await expect(page.getByRole('heading', { level: 1, name: 'Abo' })).toBeVisible();
	await expect(page.getByText('Testphase bis')).toBeVisible();
	await expect(page.getByText('9,90 € pro Monat')).toBeVisible();
	const notice = page.getByRole('note').filter({ hasText: 'Deine Testphase endet am' });
	await expect(notice).toBeVisible();
	await expect(notice.getByRole('link', { name: 'Zum Abo' })).toHaveAttribute('href', '/abo');

	// Checkout: the app creates the customer, then the session, and the browser follows its URL
	// (the fake answers with the success URL).
	requests.length = 0;
	await page.getByRole('button', { name: 'Abo abschließen' }).click();
	await expect(page).toHaveURL(/\/abo\?erfolg=1$/);
	await expect(page.getByRole('status').filter({ hasText: 'Danke!' })).toBeVisible();
	const customer = requests.find((entry) => entry.path === '/v1/customers');
	expect(customer?.method).toBe('POST');
	expect(customer?.authorization).toBe('Bearer sk_test_fake');
	expect(customer?.params.get('email')).toBe('vermieterin@example.org');
	const session = requests.find((entry) => entry.path === '/v1/checkout/sessions');
	expect(session?.params.get('mode')).toBe('subscription');
	expect(session?.params.get('customer')).toBe(FAKE_CUSTOMER_ID);
	expect(session?.params.get('line_items[0][price]')).toBe('price_fake');
	expect(session?.params.get('cancel_url')).toMatch(/\/abo$/);
	const trialDays = Number(session?.params.get('subscription_data[trial_period_days]'));
	expect(trialDays).toBeGreaterThanOrEqual(1);
	expect(trialDays).toBeLessThanOrEqual(30);

	// Stripe reports the completed Checkout; the app fetches the subscription from the API.
	const completed = await postEvent(page.request, {
		id: eventId(),
		type: 'checkout.session.completed',
		data: {
			object: {
				id: 'cs_fake',
				object: 'checkout.session',
				mode: 'subscription',
				customer: FAKE_CUSTOMER_ID,
				subscription: FAKE_SUBSCRIPTION_ID
			}
		}
	});
	expect(completed.status()).toBe(200);
	expect(requests.some((entry) => entry.path === `/v1/subscriptions/${FAKE_SUBSCRIPTION_ID}`)).toBe(
		true
	);
	await page.goto('/abo');
	await expect(page.getByText('Dein Abo ist aktiv.')).toBeVisible();
	await expect(page.getByText('Aktiv', { exact: true })).toBeVisible();
	await expect(page.getByText('15.01.2030')).toBeVisible();
	await expect(page.getByRole('note').filter({ hasText: 'Testphase' })).toHaveCount(0);

	// A failed payment shows a warning above every page …
	const failed = await postEvent(page.request, {
		id: eventId(),
		type: 'customer.subscription.updated',
		data: {
			object: {
				id: FAKE_SUBSCRIPTION_ID,
				object: 'subscription',
				status: 'past_due',
				customer: FAKE_CUSTOMER_ID,
				current_period_end: FAKE_PERIOD_END
			}
		}
	});
	expect(failed.status()).toBe(200);
	await page.goto('/objekte');
	await expect(
		page.getByRole('note').filter({ hasText: 'Die letzte Zahlung ist fehlgeschlagen.' })
	).toBeVisible();

	// … until the subscription is active again, with a new period end.
	const recovered = {
		id: eventId(),
		type: 'customer.subscription.updated',
		data: {
			object: {
				id: FAKE_SUBSCRIPTION_ID,
				object: 'subscription',
				status: 'active',
				customer: FAKE_CUSTOMER_ID,
				// 2030-02-15T00:00:00Z
				current_period_end: 1_897_344_000
			}
		}
	};
	const active = await postEvent(page.request, recovered);
	expect(active.status()).toBe(200);
	await page.goto('/abo');
	await expect(page.getByText('Dein Abo ist aktiv.')).toBeVisible();
	await expect(page.getByText('15.02.2030')).toBeVisible();
	await expect(page.getByRole('note')).toHaveCount(0);

	// The same event delivered again is answered with 200 and changes nothing.
	const again = await postEvent(page.request, recovered);
	expect(again.status()).toBe(200);
	expect(await again.json()).toEqual({ received: true, duplicate: true });
	await page.reload();
	await expect(page.getByText('Dein Abo ist aktiv.')).toBeVisible();
	await expect(page.getByText('15.02.2030')).toBeVisible();

	// The Customer Portal: the app asks Stripe for a session and follows its URL (the fake
	// answers with the return URL, so the browser lands back on the page).
	requests.length = 0;
	await page.getByRole('button', { name: 'Abo verwalten' }).click();
	// The page is already on /abo, so wait for the request to Stripe, not for the URL.
	await expect
		.poll(() => requests.some((entry) => entry.path === '/v1/billing_portal/sessions'))
		.toBe(true);
	await expect(page).toHaveURL(/\/abo$/);
	const portal = requests.find((entry) => entry.path === '/v1/billing_portal/sessions');
	expect(portal?.params.get('customer')).toBe(FAKE_CUSTOMER_ID);
	expect(portal?.params.get('return_url')).toMatch(/\/abo$/);
});

test('refuses webhooks with a bad signature or an old timestamp', async ({ page }) => {
	const event = {
		id: eventId(),
		type: 'customer.subscription.deleted',
		data: { object: { id: FAKE_SUBSCRIPTION_ID, status: 'canceled', customer: FAKE_CUSTOMER_ID } }
	};
	const wrongSecret = await postEvent(page.request, event, { secret: 'whsec_other' });
	expect(wrongSecret.status()).toBe(400);
	const old = await postEvent(page.request, event, {
		timestamp: Math.floor(Date.now() / 1000) - 600
	});
	expect(old.status()).toBe(400);
	const unsigned = await page.request.post('/webhooks/stripe', {
		data: JSON.stringify(event),
		headers: { 'content-type': 'application/json' }
	});
	expect(unsigned.status()).toBe(400);
	// None of them changed the subscription.
	await page.goto('/abo');
	await expect(page.getByText('Dein Abo ist aktiv.')).toBeVisible();
});

test('answers unknown pages under /abo with 404', async ({ page }) => {
	const response = await page.goto('/abo/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
});
