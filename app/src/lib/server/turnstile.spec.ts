import { describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from './turnstile';

function answering(body: unknown, status = 200) {
	return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('verifyTurnstile', () => {
	it('accepts a token Cloudflare confirms and sends secret, token and address', async () => {
		const fetcher = answering({ success: true });
		expect(await verifyTurnstile('token', '1.2.3.4', 'secret', fetcher)).toBe(true);
		const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
		const sent = new URLSearchParams(init.body as URLSearchParams);
		expect(Object.fromEntries(sent)).toEqual({
			secret: 'secret',
			response: 'token',
			remoteip: '1.2.3.4'
		});
	});

	it('refuses a token Cloudflare rejects', async () => {
		expect(await verifyTurnstile('token', '1.2.3.4', 'secret', answering({ success: false }))).toBe(
			false
		);
	});

	it('refuses a missing token without asking Cloudflare', async () => {
		const fetcher = answering({ success: true });
		expect(await verifyTurnstile(null, '1.2.3.4', 'secret', fetcher)).toBe(false);
		expect(await verifyTurnstile('', '1.2.3.4', 'secret', fetcher)).toBe(false);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('refuses when Cloudflare cannot be reached', async () => {
		const failing = vi.fn(async () => {
			throw new Error('offline');
		});
		expect(await verifyTurnstile('token', '1.2.3.4', 'secret', failing)).toBe(false);
		expect(await verifyTurnstile('token', '1.2.3.4', 'secret', answering({}, 500))).toBe(false);
	});
});
