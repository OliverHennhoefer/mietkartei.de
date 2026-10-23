import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { outbox } from './db/schema';
import { sendMail, sendMailInBackground } from './mail';
import { testDatabase } from './testing';

const env = vi.hoisted(() => ({
	MAIL_TRANSPORT: 'outbox' as 'outbox' | 'resend' | 'console',
	MAIL_API_KEY: 're_unit',
	MAIL_FROM: 'mietkartei <noreply@mietkartei.de>'
}));
vi.mock('$app/env/private', () => env);

const mail = { to: 'a@example.org', subject: 'Betreff', text: 'Hallo' };

beforeEach(() => {
	env.MAIL_TRANSPORT = 'outbox';
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('sendMail', () => {
	it('stores the mail in the outbox for the end-to-end tests', async () => {
		const db = await testDatabase();
		await sendMail(db, mail);
		expect(await db.select().from(outbox)).toMatchObject([mail]);
	});

	it('posts to Resend with the API key and sender', async () => {
		env.MAIL_TRANSPORT = 'resend';
		const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
			Response.json({ id: 'm_1' })
		);
		vi.stubGlobal('fetch', fetch);
		await sendMail(await testDatabase(), mail);
		const [url, init] = fetch.mock.calls[0];
		expect(url).toBe('https://api.resend.com/emails');
		expect(init.headers).toMatchObject({ authorization: 'Bearer re_unit' });
		expect(JSON.parse(init.body as string)).toEqual({
			from: 'mietkartei <noreply@mietkartei.de>',
			to: ['a@example.org'],
			subject: 'Betreff',
			text: 'Hallo'
		});
	});

	it('throws when Resend refuses the mail', async () => {
		env.MAIL_TRANSPORT = 'resend';
		vi.stubGlobal('fetch', async () => new Response('invalid from', { status: 422 }));
		await expect(sendMail(await testDatabase(), mail)).rejects.toThrow(
			'Mail provider answered 422: invalid from'
		);
	});

	it('logs the mail on the console transport', async () => {
		env.MAIL_TRANSPORT = 'console';
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await sendMail(await testDatabase(), mail);
		expect(log).toHaveBeenCalledWith(expect.stringContaining('[mail] to a@example.org'));
	});
});

describe('sendMailInBackground', () => {
	it('logs a failure and withdraws what the mail was for, without throwing', async () => {
		env.MAIL_TRANSPORT = 'resend';
		vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const withdrawn = Promise.withResolvers<void>();
		await sendMailInBackground(await testDatabase(), mail, async () => withdrawn.resolve());
		await withdrawn.promise;
		expect(logged).toHaveBeenCalledWith('[mail] "Betreff" was not sent:', expect.any(Error));
	});

	it('logs a failing cleanup as well', async () => {
		env.MAIL_TRANSPORT = 'resend';
		vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const cleanup = Promise.withResolvers<void>();
		await sendMailInBackground(await testDatabase(), mail, async () => {
			cleanup.resolve();
			throw new Error('db gone');
		});
		await cleanup.promise;
		await vi.waitFor(() =>
			expect(logged).toHaveBeenCalledWith('[mail] Cleanup failed:', expect.any(Error))
		);
	});
});
