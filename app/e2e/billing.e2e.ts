import { expect, test, type APIRequestContext } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';
import {
	checkoutSessions,
	completeCheckout,
	FAKE_CUSTOMER_ID,
	FAKE_PERIOD_END,
	FAKE_SUBSCRIPTION_ID,
	requests,
	start,
	stop,
	subscription
} from './stripe-fake';

// The web server runs with STRIPE_SECRET_KEY=sk_test_fake, STRIPE_PRICE_ID=price_fake,
// STRIPE_WEBHOOK_SECRET=whsec_fake and STRIPE_API_BASE pointing at e2e/stripe-fake.ts.
const WEBHOOK_SECRET = 'whsec_fake';

// The later tests build on the subscription the first one starts, so a retry runs them all.
test.describe.configure({ mode: 'serial' });

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
	return request.post('/api/webhooks/stripe', {
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

test('shows the trial, subscribes through Checkout and follows the webhooks', async ({
	page,
	baseURL
}) => {
	// A fresh account is in its 30-day trial: the page and the notice above every page say so.
	// The settings and the navigation lead to the page.
	await page.goto('/einstellungen');
	await page
		.getByRole('list', { name: 'Einstellungen' })
		.getByRole('link', { name: 'Abo' })
		.click();
	await expect(page.getByRole('heading', { level: 1, name: 'Abo' })).toBeVisible();
	await expect(
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Abo' })
	).toHaveAttribute('aria-current', 'page');
	await expect(page.getByText('Testphase bis')).toBeVisible();
	await expect(page.getByText('9,90 € pro Monat')).toBeVisible();
	const notice = page.getByRole('note').filter({ hasText: 'Deine Testphase endet am' });
	await expect(notice).toBeVisible();
	await expect(notice.getByRole('link', { name: 'Zum Abo' })).toHaveAttribute('href', '/abo');

	// Checkout: the app creates the customer, then the session, and the browser follows its URL
	// (the fake answers with the success URL). Opened twice before paying, from a second tab
	// say, the second post reuses the open session, so only one subscription can come of it.
	requests.length = 0;
	const first = await page.request.post('/abo?/checkout', {
		form: {},
		headers: { origin: baseURL!, accept: 'text/html' },
		maxRedirects: 0
	});
	expect(first.status()).toBe(303);
	expect(first.headers().location).toMatch(/\/abo\?erfolg=1$/);
	await page.getByRole('button', { name: 'Abo abschließen' }).click();
	await expect(page).toHaveURL(/\/abo\?erfolg=1$/);
	await expect(page.getByRole('status').filter({ hasText: 'Danke!' })).toBeVisible();
	const created = () =>
		requests.filter((entry) => entry.method === 'POST' && entry.path === '/v1/checkout/sessions');
	expect(created()).toHaveLength(1);
	expect([...checkoutSessions.values()].map((entry) => entry.status)).toEqual(['open']);
	const [checkoutId] = checkoutSessions.keys();
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

	// Paid, but the webhook has not arrived yet: another Checkout is refused, since the
	// subscription exists at Stripe already.
	completeCheckout(checkoutId);
	const early = await page.request.post('/abo?/checkout', {
		form: {},
		headers: { origin: baseURL! }
	});
	expect(early.status()).toBe(409);
	expect(created()).toHaveLength(1);

	// Stripe reports the completed Checkout; the app fetches the subscription from the API.
	const completed = await postEvent(page.request, {
		id: eventId(),
		type: 'checkout.session.completed',
		data: {
			object: {
				id: checkoutId,
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

	// A failed payment shows a warning above every page … (the app reads the status back from
	// the API, so the fake's subscription changes first, as Stripe's would)
	subscription.status = 'past_due';
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
	Object.assign(subscription, { status: 'active', current_period_end: 1_897_344_000 });
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

	// A second Checkout, from a stale tab say, would start a second subscription: refused.
	requests.length = 0;
	const second = await page.request.post('/abo?/checkout', {
		form: {},
		headers: { origin: baseURL! }
	});
	expect(second.status()).toBe(400);
	expect(requests.some((entry) => entry.path === '/v1/checkout/sessions')).toBe(false);

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

test('applies the current subscription, not a late delivery of an older event', async ({
	page
}) => {
	// Stripe ends the subscription …
	subscription.status = 'canceled';
	const deleted = await postEvent(page.request, {
		id: eventId(),
		type: 'customer.subscription.deleted',
		data: { object: { id: FAKE_SUBSCRIPTION_ID, status: 'canceled', customer: FAKE_CUSTOMER_ID } }
	});
	expect(deleted.status()).toBe(200);
	await page.goto('/abo');
	await expect(page.getByText('Gekündigt', { exact: true })).toBeVisible();

	// … and then delivers an older "active" event again, e.g. after a failed first delivery. Its
	// payload is stale, so the account stays canceled.
	const late = await postEvent(page.request, {
		id: eventId(),
		type: 'customer.subscription.updated',
		data: {
			object: {
				id: FAKE_SUBSCRIPTION_ID,
				status: 'active',
				customer: FAKE_CUSTOMER_ID,
				current_period_end: FAKE_PERIOD_END
			}
		}
	});
	expect(late.status()).toBe(200);
	await page.reload();
	await expect(page.getByText('Gekündigt', { exact: true })).toBeVisible();
	await expect(page.getByText('Dein Abo ist aktiv.')).toHaveCount(0);

	// The landlord subscribes again in the portal: the next event brings the active state back,
	// which the account deletion in konto.e2e.ts cancels.
	Object.assign(subscription, { status: 'active', current_period_end: 1_897_344_000 });
	const resumed = await postEvent(page.request, {
		id: eventId(),
		type: 'customer.subscription.updated',
		data: { object: { id: FAKE_SUBSCRIPTION_ID, status: 'active', customer: FAKE_CUSTOMER_ID } }
	});
	expect(resumed.status()).toBe(200);
	await page.reload();
	await expect(page.getByText('Dein Abo ist aktiv.')).toBeVisible();
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
	const unsigned = await page.request.post('/api/webhooks/stripe', {
		data: JSON.stringify(event),
		headers: { 'content-type': 'application/json' }
	});
	expect(unsigned.status()).toBe(400);
	// Far larger than any Stripe event: refused before the signature is checked.
	const huge = await page.request.post('/api/webhooks/stripe', {
		data: 'x'.repeat(600 * 1024),
		headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' }
	});
	expect(huge.status()).toBe(413);
	// None of them changed the subscription.
	await page.goto('/abo');
	await expect(page.getByText('Dein Abo ist aktiv.')).toBeVisible();
});

test('answers unknown pages under /abo with 404', async ({ page }) => {
	const response = await page.goto('/abo/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
});
