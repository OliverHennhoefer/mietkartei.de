import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// On the cloudflare target the database, the document storage and the rate limiters come from
// the Worker's bindings, and mail sent in the background must be handed to waitUntil, or the
// Worker stops it with the response. `cloudflare:workers` only exists in workerd; here it is a
// stub that records what the modules ask of it.

const workers = vi.hoisted(() => ({
	env: {} as Record<string, unknown>,
	waitUntil: vi.fn<(promise: Promise<unknown>) => void>()
}));
vi.mock('cloudflare:workers', () => workers);

const mailEnv = vi.hoisted(() => ({
	MAIL_TRANSPORT: 'console' as 'outbox' | 'resend' | 'console',
	MAIL_API_KEY: '',
	MAIL_FROM: 'mietkartei <noreply@example.org>',
	GENESIS_API_TOKEN: 'token'
}));
vi.mock('$app/env/private', () => mailEnv);

beforeEach(() => {
	vi.resetModules();
	workers.env = {};
	workers.waitUntil.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('bindings on the cloudflare target', () => {
	it('opens the database on the D1 binding', async () => {
		const { getDatabase } = await import('./db');
		await expect(getDatabase()).rejects.toThrow('The D1 binding "DB" is not configured');
		vi.resetModules();
		workers.env.DB = { prepare: vi.fn(), batch: vi.fn(), exec: vi.fn() };
		const db = await (await import('./db')).getDatabase();
		// Drizzle keeps the client it wraps; the Database type hides it.
		expect((db as unknown as { $client: unknown }).$client).toBe(workers.env.DB);
	});

	it('keeps documents in the R2 binding', async () => {
		const put = vi.fn(async () => undefined);
		workers.env.DOCUMENTS = { put };
		const { getStorage } = await import('./storage');
		const storage = await getStorage();
		await storage.put('a/1', new Uint8Array([1]), 'application/pdf');
		expect(put).toHaveBeenCalledWith('a/1', new Uint8Array([1]), {
			httpMetadata: { contentType: 'application/pdf' }
		});
		expect(await getStorage()).toBe(storage);
	});

	it('counts sign-ins and API calls in their own rate limit bindings', async () => {
		const auth = vi.fn(async () => ({ success: false }));
		const api = vi.fn(async () => ({ success: true }));
		workers.env.AUTH_LIMITER = { limit: auth };
		workers.env.API_LIMITER = { limit: api };
		const { getApiLimiter, getAuthLimiter } = await import('./rate-limit');
		expect(await (await getAuthLimiter()).limit('ip:1')).toBe(false);
		expect(await (await getApiLimiter()).limit('key:1')).toBe(true);
		expect(auth).toHaveBeenCalledWith({ key: 'ip:1' });
		expect(api).toHaveBeenCalledWith({ key: 'key:1' });
	});
});

describe('mail on the cloudflare target', () => {
	const mail = { to: 'mieter@example.org', subject: 'Anmeldelink', text: 'https://…' };

	it('refuses to log mails to the console, as their links sign people in', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const { sendMail } = await import('./mail');
		await expect(sendMail({} as never, mail)).rejects.toThrow(
			'MAIL_TRANSPORT=console is refused on the cloudflare target'
		);
		expect(log).not.toHaveBeenCalled();
	});

	it('lets the Worker finish a background mail after the response', async () => {
		const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
		const onFailure = vi.fn(async () => undefined);
		const { sendMailInBackground } = await import('./mail');
		await sendMailInBackground({} as never, mail, onFailure);
		expect(workers.waitUntil).toHaveBeenCalledTimes(1);
		// The refused console transport fails the mail; waitUntil holds the cleanup too.
		await workers.waitUntil.mock.calls[0][0];
		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(failed).toHaveBeenCalled();
	});
});

describe('the VPI fetch on the cloudflare target', () => {
	it('lets the Worker finish the fetch after the response', async () => {
		const table =
			'time;1_variable_code;1_variable_attribute_code;value;value_unit;value_variable_code\n' +
			'2026;MONAT;MONAT01;122,8;2020=100;PREIS1\n';
		let answer: (response: Response) => void = () => {};
		const fetcher = vi
			.spyOn(globalThis, 'fetch')
			.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
		const { testDatabase } = await import('./testing');
		const { currentIndexValues, lastIndexFetch } = await import('./consumer-price-index');
		const db = await testDatabase();

		// The page gets the stored values (none yet) without waiting for Destatis.
		expect(await currentIndexValues(db)).toEqual([]);
		expect(workers.waitUntil).toHaveBeenCalledTimes(1);
		answer(new Response(table));
		await workers.waitUntil.mock.calls[0][0];
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(await lastIndexFetch(db)).toMatchObject({ error: null });

		// The next page shows the values and starts no second fetch.
		expect(await currentIndexValues(db)).toEqual([
			{ baseYear: '2020', month: '2026-01', value: 122.8 }
		]);
		expect(workers.waitUntil).toHaveBeenCalledTimes(1);
	});
});
