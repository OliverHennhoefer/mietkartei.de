import { describe, expect, it } from 'vitest';
import {
	fromBase64,
	fromBase64Url,
	hmacSha256Hex,
	pkcs8Bytes,
	sha256Hex,
	toBase64,
	toBase64Url,
	toHex
} from './encoding';

describe('base64', () => {
	it('round-trips bytes, including a windows-1252 ü', () => {
		const bytes = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x0a]);
		expect(toBase64(bytes)).toBe('TfxsbGVyCg==');
		expect(Array.from(fromBase64('TfxsbGVyCg=='))).toEqual(Array.from(bytes));
	});

	it('handles more than one chunk', () => {
		const bytes = new Uint8Array(70_000).map((_, index) => index % 251);
		expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
	});

	it('refuses what is not base64', () => {
		expect(() => fromBase64('not base64!')).toThrow();
	});
});

describe('base64url', () => {
	it('uses - and _ without padding and reads it back with or without padding', () => {
		const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x01]);
		expect(toBase64(bytes)).toBe('+/+/AQ==');
		expect(toBase64Url(bytes)).toBe('-_-_AQ');
		expect(Array.from(fromBase64Url('-_-_AQ'))).toEqual(Array.from(bytes));
		expect(Array.from(fromBase64Url('-_-_AQ=='))).toEqual(Array.from(bytes));
	});
});

describe('pkcs8Bytes', () => {
	it('reads the body of a PEM key, also from a secret with escaped line breaks', () => {
		const pem = '-----BEGIN PRIVATE KEY-----\nAQID\nBA==\n-----END PRIVATE KEY-----\n';
		expect(Array.from(pkcs8Bytes(pem))).toEqual([1, 2, 3, 4]);
		expect(Array.from(pkcs8Bytes(pem.replaceAll('\n', '\\n')))).toEqual([1, 2, 3, 4]);
	});
});

describe('hex digests', () => {
	it('writes two lower-case digits a byte', () => {
		expect(toHex(new Uint8Array([0, 9, 171, 255]))).toBe('0009abff');
	});

	it('hashes UTF-8 text with SHA-256', async () => {
		expect(await sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});

	it('signs with HMAC-SHA256 (RFC 4231, test case 2)', async () => {
		expect(await hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
			'5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
		);
	});
});
