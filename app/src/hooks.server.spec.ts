import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '#lib/server/auth.ts';
import type { Database } from '#lib/server/db/index.ts';
import { accounts } from '#lib/server/db/schema.ts';
import { outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { handle } from './hooks.server';

const env = vi.hoisted(() => ({
	DEMO: false,
	E2E: false,
	BILLING_REQUIRED: false,
	STRIPE_SECRET_KEY: '',
	STRIPE_PRICE_ID: ''
}));
vi.mock('$app/env/private', () => env);

let db: Database;
vi.mock('#lib/server/db/index.ts', () => ({ getDatabase: async () => db }));

beforeEach(async () => {
	db = await testDatabase();
	Object.assign(env, { DEMO: false, E2E: false, BILLING_REQUIRED: false, STRIPE_SECRET_KEY: '' });
});

type Request = {
	method?: 'GET' | 'POST';
	cookies?: Map<string, string>;
	clientAddress?: string;
};

/** Sends one request through the hook; the page behind it answers 200. */
async function send(path: string, { method = 'GET', cookies, clientAddress }: Request = {}) {
	const event = routeEvent(db, {
		url: path,
		form: method === 'POST' ? {} : undefined,
		cookies,
		clientAddress,
		user: null
	}) as { locals: App.Locals };
	const resolve = vi.fn(async () => new Response('ok'));
	const result = await outcome(() => handle({ event, resolve } as never));
	return { result, resolved: resolve.mock.calls.length > 0, locals: event.locals };
}

describe('handle', () => {
	it('sends visitors without a session to the sign-in page', async () => {
		expect((await send('/objekte')).result).toEqual({ redirect: '/anmelden' });
		expect((await send('/')).result).toEqual({ redirect: '/anmelden' });
	});

	it('lets visitors reach the public pages and adds the security headers', async () => {
		for (const path of [
			'/anmelden',
			'/registrieren',
			'/registrieren/token',
			'/passwort-zuruecksetzen/token',
			'/einladung/token',
			'/e-mail-bestaetigen/token',
			'/health',
			'/robots.txt'
		]) {
			const { result, resolved } = await send(path);
			expect(resolved, path).toBe(true);
			const response = (result as { data: Response }).data;
			expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		}
	});

	it('opens the test routes only on the end-to-end server', async () => {
		expect((await send('/api/e2e/seed')).result).toEqual({ redirect: '/anmelden' });
		env.E2E = true;
		expect((await send('/api/e2e/seed')).resolved).toBe(true);
	});

	it('sends visitors of the demo to its start page instead of any sign-in', async () => {
		env.DEMO = true;
		for (const path of ['/', '/objekte', '/anmelden', '/registrieren']) {
			expect((await send(path)).result, path).toEqual({ redirect: '/demo' });
		}
		expect((await send('/demo')).resolved).toBe(true);
		expect((await send('/health')).resolved).toBe(true);
		expect((await send('/robots.txt')).resolved).toBe(true);
	});

	it('keeps every page out of search engines except the start page of the demo', async () => {
		const robots = async (path: string) =>
			((await send(path)).result as { data: Response }).data.headers.get('X-Robots-Tag');
		expect(await robots('/anmelden')).toBe('noindex, nofollow');
		expect(await robots('/health')).toBe('noindex, nofollow');
		env.DEMO = true;
		expect(await robots('/demo')).toBeNull();
		expect(await robots('/health')).toBe('noindex, nofollow');
	});

	it('signs the request in with a valid session cookie', async () => {
		const { token } = await createSession(db, 'user-a');
		const { resolved, locals } = await send('/objekte', { cookies: new Map([['session', token]]) });
		expect(resolved).toBe(true);
		expect(locals.user).toMatchObject({ id: 'user-a', accountId: 'a', role: 'owner' });
	});

	it('deletes an unknown session cookie and treats the request as a visitor', async () => {
		const cookies = new Map([['session', 'unknown']]);
		expect((await send('/objekte', { cookies })).result).toEqual({ redirect: '/anmelden' });
		expect(cookies.has('session')).toBe(false);
	});

	it('limits posts to the sign-in forms per client address', async () => {
		for (let attempt = 0; attempt < 10; attempt++) {
			const { resolved } = await send('/anmelden', { method: 'POST', clientAddress: '10.0.0.1' });
			expect(resolved).toBe(true);
		}
		expect((await send('/anmelden', { method: 'POST', clientAddress: '10.0.0.1' })).result).toEqual(
			{ error: 429, message: expect.stringContaining('Zu viele Versuche') }
		);
		// The same path from another address, and pages that read, are not affected.
		expect((await send('/anmelden', { method: 'POST', clientAddress: '10.0.0.2' })).resolved).toBe(
			true
		);
		expect((await send('/anmelden', { clientAddress: '10.0.0.1' })).resolved).toBe(true);
		// Reset and invitation links count toward the same limit.
		const result = await send('/einladung/token', { method: 'POST', clientAddress: '10.0.0.1' });
		expect(result.result).toMatchObject({ error: 429 });
	});

	it('refuses writes of an account whose trial ended without a subscription', async () => {
		Object.assign(env, { BILLING_REQUIRED: true, STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_ID: 'p' });
		await db
			.update(accounts)
			.set({ trialEndsAt: new Date('2020-01-01') })
			.where(eq(accounts.id, 'a'));
		const { token } = await createSession(db, 'user-a');
		const cookies = new Map([['session', token]]);
		expect((await send('/objekte', { cookies })).resolved).toBe(true);
		expect((await send('/objekte/neu', { method: 'POST', cookies })).result).toMatchObject({
			error: 403
		});
	});
});
