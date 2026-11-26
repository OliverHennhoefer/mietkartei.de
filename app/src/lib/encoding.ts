// Base64, base64url and hex of bytes, and the SHA-256 and HMAC-SHA256 hex digests built on them.
// Only web APIs (btoa, atob, WebCrypto), so the same code runs in the browser, on Node and on
// Workers, where Buffer does not exist.

const encoder = new TextEncoder();

/** Standard base64 with padding. Built in chunks, so a file of megabytes fits the call stack. */
export function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

/** The bytes of standard base64; throws on anything that is not base64. */
export function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** URL-safe base64 without padding (RFC 4648 § 5), as JWTs and Web Push use it. */
export function toBase64Url(bytes: Uint8Array): string {
	return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** The bytes of base64url, with or without padding; throws on anything else. */
export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
	return fromBase64(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

/** The DER bytes of a PKCS#8 PEM key ("-----BEGIN PRIVATE KEY-----"), also with escaped `\n`. */
export function pkcs8Bytes(pem: string): Uint8Array<ArrayBuffer> {
	return fromBase64(
		pem
			.replace(/\\n/g, '\n')
			.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
			.replace(/\s+/g, '')
	);
}

/** Lower-case hex, two digits a byte. */
export function toHex(bytes: Uint8Array | ArrayBuffer): string {
	return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The SHA-256 of the UTF-8 text as lower-case hex. */
export async function sha256Hex(text: string): Promise<string> {
	return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/** The HMAC-SHA256 of the UTF-8 message under the UTF-8 secret, as lower-case hex. */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}
