import { describe, expect, it } from 'vitest';
import { allowFormRedirect, applySecurityHeaders } from './security-headers';

describe('applySecurityHeaders', () => {
	it('forbids framing, referrers and device APIs', () => {
		const headers = new Headers();
		applySecurityHeaders(headers, { https: false, signedIn: false });
		expect(headers.get('X-Frame-Options')).toBe('DENY');
		expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(headers.get('Referrer-Policy')).toBe('same-origin');
		expect(headers.get('Permissions-Policy')).toContain('camera=()');
		expect(headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
	});

	it('sends HSTS only over https', () => {
		const http = new Headers();
		applySecurityHeaders(http, { https: false, signedIn: false });
		expect(http.has('Strict-Transport-Security')).toBe(false);

		const https = new Headers();
		applySecurityHeaders(https, { https: true, signedIn: false });
		expect(https.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
	});

	it('keeps pages of signed-in users out of caches unless the route set its own caching', () => {
		const page = new Headers();
		applySecurityHeaders(page, { https: true, signedIn: true });
		expect(page.get('Cache-Control')).toBe('private, no-store');

		const anonymous = new Headers();
		applySecurityHeaders(anonymous, { https: true, signedIn: false });
		expect(anonymous.has('Cache-Control')).toBe(false);

		const download = new Headers({ 'Cache-Control': 'private, max-age=60' });
		applySecurityHeaders(download, { https: true, signedIn: true });
		expect(download.get('Cache-Control')).toBe('private, max-age=60');
	});

	it('leaves headers a route set itself', () => {
		const headers = new Headers({ 'Referrer-Policy': 'no-referrer' });
		applySecurityHeaders(headers, { https: false, signedIn: false });
		expect(headers.get('Referrer-Policy')).toBe('no-referrer');
	});
});

describe('allowFormRedirect', () => {
	it('adds the origin to form-action and leaves responses without a policy alone', () => {
		const headers = new Headers({
			'content-security-policy':
				"default-src 'self'; form-action 'self' https://x.example; base-uri 'none'"
		});
		allowFormRedirect(headers, 'https://claude.ai');
		expect(headers.get('content-security-policy')).toBe(
			"default-src 'self'; form-action 'self' https://x.example https://claude.ai; base-uri 'none'"
		);
		const plain = new Headers();
		allowFormRedirect(plain, 'https://claude.ai');
		expect(plain.has('content-security-policy')).toBe(false);
	});
});
