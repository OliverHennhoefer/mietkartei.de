import { describe, expect, it } from 'vitest';
import { mailLinkOrigin } from './mail-links';

describe('mailLinkOrigin', () => {
	const url = (href: string) => new URL(href);

	it('takes ORIGIN when it is set, whatever host the request names', () => {
		expect(
			mailLinkOrigin(
				url('http://evil.example/passwort-vergessen'),
				'https://mk.example.de/',
				'node'
			)
		).toBe('https://mk.example.de');
		expect(
			mailLinkOrigin(url('https://worker.example/x'), 'https://mk.example.de', 'cloudflare')
		).toBe('https://mk.example.de');
	});

	it('trusts only loopback hosts on node without ORIGIN', () => {
		expect(mailLinkOrigin(url('http://localhost:3000/x'), '', 'node')).toBe(
			'http://localhost:3000'
		);
		expect(mailLinkOrigin(url('http://127.0.0.1:3000/x'), '', 'node')).toBe(
			'http://127.0.0.1:3000'
		);
		expect(mailLinkOrigin(url('http://[::1]:3000/x'), '', 'node')).toBe('http://[::1]:3000');
		// The Host header is the client's: a link to it could hand the token to a foreign site.
		expect(mailLinkOrigin(url('http://evil.example/x'), '', 'node')).toBeUndefined();
		expect(mailLinkOrigin(url('http://192.168.1.5:3000/x'), '', 'node')).toBeUndefined();
		expect(mailLinkOrigin(url('http://localhost.evil.example/x'), '', 'node')).toBeUndefined();
	});

	it('trusts the routed host on Workers', () => {
		expect(mailLinkOrigin(url('https://mk.example.de/x'), '', 'cloudflare')).toBe(
			'https://mk.example.de'
		);
	});
});
