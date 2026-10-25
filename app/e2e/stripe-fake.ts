import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * A stand-in for the Stripe API, just enough for the billing pages: the app reaches it because
 * the Playwright web servers set STRIPE_API_BASE=http://localhost:4299 (STRIPE_FAKE_PORT changes
 * it). Checkout and portal sessions answer with the URL the app passed in, so the browser lands
 * back in the app. Checkout sessions are kept, so the app can read them back and expire them.
 * Every request is recorded, so a test can check what the app sent. The subscription is state
 * a test changes before it posts a webhook, because the app reads it back from the API.
 */

export const STRIPE_FAKE_PORT = Number(process.env.STRIPE_FAKE_PORT || 4299);
export const FAKE_CUSTOMER_ID = 'cus_fake';
export const FAKE_SUBSCRIPTION_ID = 'sub_fake';
/** 2030-01-15T00:00:00Z, far enough ahead for every run. */
export const FAKE_PERIOD_END = 1_894_665_600;

export type RecordedRequest = {
	method: string;
	path: string;
	params: URLSearchParams;
	authorization: string | null;
};

export const requests: RecordedRequest[] = [];

/** The state of sub_fake as GET /v1/subscriptions/sub_fake answers it; start() resets it. */
export const subscription = { status: 'active', current_period_end: FAKE_PERIOD_END };

export type FakeCheckoutSession = {
	id: string;
	status: 'open' | 'complete' | 'expired';
	url: string | null;
	subscription: string | null;
	/** What the app stored on the session, like Stripe's metadata[…] parameters. */
	metadata: Record<string, string>;
};

/** The Checkout sessions the app created, by id; start() empties it. */
export const checkoutSessions = new Map<string, FakeCheckoutSession>();

/** Completes a session the way paying on Stripe's page does; the webhook is the test's to send. */
export function completeCheckout(id: string): void {
	const session = checkoutSessions.get(id);
	if (!session) throw new Error(`No Checkout session ${id}`);
	Object.assign(session, { status: 'complete', url: null, subscription: FAKE_SUBSCRIPTION_ID });
}

function checkoutSessionObject(session: FakeCheckoutSession) {
	return { object: 'checkout.session', mode: 'subscription', ...session };
}

function subscriptionObject() {
	return {
		id: FAKE_SUBSCRIPTION_ID,
		object: 'subscription',
		customer: FAKE_CUSTOMER_ID,
		...subscription
	};
}

let server: Server | undefined;

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		request.on('error', reject);
	});
}

function answer(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, { 'content-type': 'application/json' });
	response.end(JSON.stringify(body));
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const url = new URL(request.url ?? '/', `http://localhost:${STRIPE_FAKE_PORT}`);
	const method = request.method ?? 'GET';
	const body = await readBody(request);
	const params = new URLSearchParams(method === 'GET' ? url.search : body);
	requests.push({
		method,
		path: url.pathname,
		params,
		authorization: request.headers.authorization ?? null
	});

	if (!request.headers.authorization?.startsWith('Bearer sk_')) {
		return answer(response, 401, { error: { message: 'No valid API key provided.' } });
	}
	if (method === 'POST' && url.pathname === '/v1/customers') {
		return answer(response, 200, {
			id: FAKE_CUSTOMER_ID,
			object: 'customer',
			email: params.get('email')
		});
	}
	if (method === 'POST' && url.pathname === '/v1/checkout/sessions') {
		const session: FakeCheckoutSession = {
			id: `cs_fake_${checkoutSessions.size + 1}`,
			status: 'open',
			url: params.get('success_url'),
			subscription: null,
			metadata: Object.fromEntries(
				[...params]
					.filter(([key]) => /^metadata\[[^\]]+\]$/.test(key))
					.map(([key, value]) => [key.slice('metadata['.length, -1), value])
			)
		};
		checkoutSessions.set(session.id, session);
		return answer(response, 200, checkoutSessionObject(session));
	}
	const checkout = /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(url.pathname);
	if (checkout) {
		const session = checkoutSessions.get(decodeURIComponent(checkout[1]));
		if (!session) {
			return answer(response, 404, { error: { message: 'No such checkout.session' } });
		}
		if (method === 'GET' && !checkout[2])
			return answer(response, 200, checkoutSessionObject(session));
		if (method === 'POST' && checkout[2]) {
			// Like Stripe: only an open session can be expired.
			if (session.status !== 'open') {
				return answer(response, 400, { error: { message: 'Session is not open' } });
			}
			Object.assign(session, { status: 'expired', url: null });
			return answer(response, 200, checkoutSessionObject(session));
		}
	}
	if (method === 'POST' && url.pathname === '/v1/billing_portal/sessions') {
		return answer(response, 200, {
			id: 'bps_fake',
			object: 'billing_portal.session',
			url: params.get('return_url')
		});
	}
	if (method === 'GET' && url.pathname === '/v1/subscriptions') {
		// Like Stripe without `status`: the customer's subscriptions that are not canceled.
		const running =
			params.get('customer') === FAKE_CUSTOMER_ID && subscription.status !== 'canceled';
		return answer(response, 200, {
			object: 'list',
			has_more: false,
			data: running ? [subscriptionObject()] : []
		});
	}
	if (url.pathname === `/v1/subscriptions/${FAKE_SUBSCRIPTION_ID}`) {
		if (method === 'DELETE') subscription.status = 'canceled';
		if (method === 'GET' || method === 'DELETE') return answer(response, 200, subscriptionObject());
	}
	if (method === 'GET' && url.pathname === '/v1/prices/price_fake') {
		return answer(response, 200, {
			id: 'price_fake',
			object: 'price',
			unit_amount: 990,
			currency: 'eur',
			recurring: { interval: 'month' }
		});
	}
	answer(response, 404, {
		error: { message: `Unrecognized request URL (${method}: ${url.pathname}).` }
	});
}

/** Starts the fake on STRIPE_FAKE_PORT; a second call while it runs does nothing. */
export async function start(): Promise<void> {
	if (server) return;
	requests.length = 0;
	checkoutSessions.clear();
	Object.assign(subscription, { status: 'active', current_period_end: FAKE_PERIOD_END });
	const instance = createServer((request, response) => {
		handle(request, response).catch((cause) => {
			answer(response, 500, { error: { message: String(cause) } });
		});
	});
	await new Promise<void>((resolve, reject) => {
		instance.once('error', reject);
		// No host, so both 127.0.0.1 and ::1 reach it, whichever "localhost" resolves to.
		instance.listen(STRIPE_FAKE_PORT, () => {
			instance.off('error', reject);
			resolve();
		});
	});
	server = instance;
}

export async function stop(): Promise<void> {
	const instance = server;
	server = undefined;
	if (!instance) return;
	await new Promise<void>((resolve) => {
		instance.closeAllConnections?.();
		instance.close(() => resolve());
	});
}
