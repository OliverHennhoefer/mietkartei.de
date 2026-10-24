import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { outbox, registrationRequests, users } from '#lib/server/db/schema.ts';
import { outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const env = vi.hoisted(() => ({
	REGISTRATION_EMAILS: '',
	ORIGIN: '',
	TURNSTILE_SITE_KEY: '',
	TURNSTILE_SECRET_KEY: '',
	MAIL_TRANSPORT: 'outbox',
	MAIL_API_KEY: '',
	MAIL_FROM: 'mietkartei <noreply@mietkartei.de>'
}));
vi.mock('$app/env/private', () => env);

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	Object.assign(env, {
		REGISTRATION_EMAILS: '',
		ORIGIN: '',
		TURNSTILE_SITE_KEY: '',
		TURNSTILE_SECRET_KEY: ''
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function register(
	form: Record<string, string>,
	options: { url?: string; cookies?: Map<string, string> } = {}
) {
	return outcome(() => actions.default(routeEvent(db, { user: null, form, ...options })));
}

describe('load', () => {
	it('sends signed-in users home', async () => {
		expect(await outcome(() => load(routeEvent(db)))).toEqual({ redirect: '/' });
	});

	it('offers the form on a new instance or with a list of addresses', async () => {
		expect(await outcome(() => load(routeEvent(db, { user: null })))).toEqual({
			data: { open: false, restricted: false, turnstileSiteKey: null }
		});
		env.REGISTRATION_EMAILS = 'neu@example.org';
		Object.assign(env, { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' });
		expect(await outcome(() => load(routeEvent(db, { user: null })))).toEqual({
			data: { open: true, restricted: true, turnstileSiteKey: 'site' }
		});
	});
});

describe('the first person on a self-hosted instance', () => {
	beforeEach(async () => {
		await db.delete(users);
	});

	it('registers with a password and is signed in', async () => {
		const cookies = new Map<string, string>();
		const form = { email: 'erste@example.org', password: 'lang-genug-1234' };
		expect(await register(form, { cookies })).toEqual({ redirect: '/' });
		expect(cookies.get('session')).toBeTruthy();
		// After that, the instance is closed.
		expect(await register({ email: 'zweite@example.org', password: 'lang-genug-1234' })).toEqual({
			fail: 403,
			data: { closed: true }
		});
	});

	it('answers form errors without the password', async () => {
		const result = await register({ email: 'kaputt', password: 'kurz' });
		expect(result).toMatchObject({ fail: 400, data: { values: { email: 'kaputt' } } });
		expect(JSON.stringify(result)).not.toContain('kurz');
	});
});

describe('with REGISTRATION_EMAILS', () => {
	beforeEach(() => {
		env.REGISTRATION_EMAILS = 'neu@example.org, a@example.org';
	});

	it('mails a link to a listed address instead of creating the account', async () => {
		expect(await register({ email: 'Neu@example.org' })).toEqual({ data: { sent: true } });
		const [mail] = await db.select().from(outbox);
		expect(mail.to).toBe('neu@example.org');
		expect(mail.text).toMatch(/http:\/\/localhost\/registrieren\/[\w-]{43}/);
		expect(await db.select().from(users)).toHaveLength(2);
	});

	it('withdraws the request when its mail cannot be sent, answering the same', async () => {
		env.MAIL_TRANSPORT = 'resend';
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('down', { status: 500 }))
		);
		try {
			expect(await register({ email: 'neu@example.org' })).toEqual({ data: { sent: true } });
			await vi.waitFor(async () => {
				expect(await db.select().from(registrationRequests)).toEqual([]);
			});
			expect(errors).toHaveBeenCalled();
		} finally {
			env.MAIL_TRANSPORT = 'outbox';
			errors.mockRestore();
		}
	});

	it('answers the same for a listed address that already has an account, without a mail', async () => {
		expect(await register({ email: 'a@example.org' })).toEqual({ data: { sent: true } });
		expect(await db.select().from(outbox)).toEqual([]);
	});

	it('refuses addresses that are not listed', async () => {
		expect(await register({ email: 'fremd@example.org' })).toEqual({
			fail: 403,
			data: { notListed: true, values: { email: 'fremd@example.org' } }
		});
	});

	it('refuses to mail a link to a host the client chose when ORIGIN is unset', async () => {
		const result = await register(
			{ email: 'neu@example.org' },
			{ url: 'http://evil.example/registrieren' }
		);
		expect(result).toMatchObject({ fail: 503 });
		expect(await db.select().from(registrationRequests)).toEqual([]);
	});

	it('uses ORIGIN for the link', async () => {
		env.ORIGIN = 'https://app.mietkartei.de';
		await register({ email: 'neu@example.org' }, { url: 'http://evil.example/registrieren' });
		const [mail] = await db.select().from(outbox);
		expect(mail.text).toContain('https://app.mietkartei.de/registrieren/');
	});

	it('requires the bot check when Turnstile is configured', async () => {
		Object.assign(env, { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' });
		const verify = vi.fn(async () => Response.json({ success: false }));
		vi.stubGlobal('fetch', verify);
		expect(await register({ email: 'neu@example.org', 'cf-turnstile-response': 'token' })).toEqual({
			fail: 400,
			data: { botCheckFailed: true, values: { email: 'neu@example.org' } }
		});
		verify.mockImplementation(async () => Response.json({ success: true }));
		expect(await register({ email: 'neu@example.org', 'cf-turnstile-response': 'token' })).toEqual({
			data: { sent: true }
		});
	});
});
