import { describe, expect, it } from 'vitest';
import { isCrossSiteForm } from './csrf';

const url = new URL('https://app.example/objekte/neu');

function post(headers: Record<string, string>, method = 'POST', target = url) {
	return isCrossSiteForm(new Request(target, { method, headers }), target);
}

describe('isCrossSiteForm', () => {
	it('refuses form posts from other origins or without one, as SvelteKit does', () => {
		const form = 'application/x-www-form-urlencoded';
		expect(post({ 'content-type': form, origin: 'https://evil.example' })).toBe(true);
		expect(post({ 'content-type': 'multipart/form-data; boundary=x' })).toBe(true);
		expect(post({ 'content-type': 'TEXT/PLAIN', origin: 'null' }, 'DELETE')).toBe(true);
		expect(post({ origin: 'https://evil.example' })).toBe(true);
	});

	it('lets through own posts, other content types, reads and the token endpoint', () => {
		expect(post({ 'content-type': 'multipart/form-data', origin: 'https://app.example' })).toBe(
			false
		);
		expect(post({ 'content-type': 'application/json', origin: 'https://evil.example' })).toBe(
			false
		);
		expect(isCrossSiteForm(new Request(url), url)).toBe(false);
		const token = new URL('https://app.example/oauth/token');
		expect(post({ 'content-type': 'application/x-www-form-urlencoded' }, 'POST', token)).toBe(
			false
		);
	});
});
