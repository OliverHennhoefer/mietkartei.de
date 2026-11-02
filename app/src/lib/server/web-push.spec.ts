import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	base64Url,
	deviceLabel,
	encryptPush,
	fromBase64Url,
	PushGoneError,
	sendPush,
	validPushEndpoint,
	validSubscriptionKeys,
	vapidKeys,
	vapidToken
} from './web-push';

afterEach(() => {
	vi.restoreAllMocks();
});

const encoder = new TextEncoder();

function pem(der: ArrayBuffer, wrap = true): string {
	const body = btoa(String.fromCharCode(...new Uint8Array(der)));
	const lines = wrap ? (body.match(/.{1,64}/g) ?? []).join('\n') : body;
	return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

async function serverKey() {
	const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	])) as CryptoKeyPair;
	return {
		pair,
		pem: pem(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
		publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
	};
}

/** A browser's subscription keys, with the private key that reads what is sent to them. */
async function browser() {
	const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
		'deriveBits'
	])) as CryptoKeyPair;
	const auth = crypto.getRandomValues(new Uint8Array(16));
	const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
	return { pair, keys: { p256dh: base64Url(p256dh), auth: base64Url(auth) } };
}

async function hkdf(
	salt: Uint8Array<ArrayBuffer>,
	ikm: Uint8Array<ArrayBuffer>,
	info: string | Uint8Array<ArrayBuffer>,
	bytes: number
) {
	const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
	const infoBytes = typeof info === 'string' ? encoder.encode(info) : info;
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'HKDF', hash: 'SHA-256', salt, info: infoBytes },
			key,
			bytes * 8
		)
	);
}

/** What the browser does with a message (RFC 8291 section 3.4, RFC 8188), written out apart. */
async function decrypt(body: Uint8Array, receiver: Awaited<ReturnType<typeof browser>>) {
	const salt = body.slice(0, 16);
	const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16);
	const idLength = body[20];
	const senderPublic = body.slice(21, 21 + idLength);
	const ciphertext = body.slice(21 + idLength);
	const senderKey = await crypto.subtle.importKey(
		'raw',
		senderPublic,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);
	const shared = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'ECDH', public: senderKey },
			receiver.pair.privateKey,
			256
		)
	);
	const receiverPublic = fromBase64Url(receiver.keys.p256dh);
	const info = new Uint8Array([
		...encoder.encode('WebPush: info'),
		0,
		...receiverPublic,
		...senderPublic
	]);
	const ikm = await hkdf(fromBase64Url(receiver.keys.auth), shared, info, 32);
	const cek = await hkdf(salt, ikm, 'Content-Encoding: aes128gcm\0', 16);
	const nonce = await hkdf(salt, ikm, 'Content-Encoding: nonce\0', 12);
	const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
	const plain = new Uint8Array(
		await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext)
	);
	return { recordSize, idLength, senderPublic, plain };
}

describe('encryptPush', () => {
	it('encrypts for the browser alone, in one record of 4096 bytes', async () => {
		const receiver = await browser();
		const body = await encryptPush(encoder.encode('{"title":"Fristen"}'), receiver.keys);
		const { recordSize, idLength, senderPublic, plain } = await decrypt(body, receiver);
		expect(recordSize).toBe(4096);
		expect(idLength).toBe(65);
		expect(senderPublic[0]).toBe(4);
		// The delimiter 2 ends the last record.
		expect(plain.at(-1)).toBe(2);
		expect(new TextDecoder().decode(plain.slice(0, -1))).toBe('{"title":"Fristen"}');

		// Another browser cannot read it.
		await expect(decrypt(body, { ...(await browser()), keys: receiver.keys })).rejects.toThrow();
	});

	it('uses a new key and salt for every message', async () => {
		const receiver = await browser();
		const one = await encryptPush(encoder.encode('a'), receiver.keys);
		const two = await encryptPush(encoder.encode('a'), receiver.keys);
		expect(base64Url(one.slice(0, 86))).not.toBe(base64Url(two.slice(0, 86)));
	});

	it('refuses a message that does not fit one record', async () => {
		const receiver = await browser();
		await expect(encryptPush(new Uint8Array(4080), receiver.keys)).rejects.toThrow(/too long/);
	});
});

describe('VAPID', () => {
	it('reads the key with or without line breaks and signs a token the services can check', async () => {
		const key = await serverKey();
		const keys = await vapidKeys(key.pem);
		expect(keys?.publicKey).toBe(base64Url(key.publicRaw));
		const flat = key.pem.replace(/\n/g, '');
		expect((await vapidKeys(flat))?.publicKey).toBe(base64Url(key.publicRaw));
		expect(await vapidKeys('')).toBeUndefined();

		const token = await vapidToken(
			'https://fcm.googleapis.com/fcm/send/abc',
			keys!,
			'https://app.example.org',
			1_000
		);
		const [header, claims, signature] = token.split('.');
		expect(JSON.parse(new TextDecoder().decode(fromBase64Url(header)))).toEqual({
			typ: 'JWT',
			alg: 'ES256'
		});
		expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims)))).toEqual({
			aud: 'https://fcm.googleapis.com',
			exp: 1_000 + 12 * 3600,
			sub: 'https://app.example.org'
		});
		const valid = await crypto.subtle.verify(
			{ name: 'ECDSA', hash: 'SHA-256' },
			key.pair.publicKey,
			fromBase64Url(signature),
			encoder.encode(`${header}.${claims}`)
		);
		expect(valid).toBe(true);
	});

	it('fails on a broken key and tries again with the next call', async () => {
		await expect(
			vapidKeys('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----')
		).rejects.toThrow();
		const key = await serverKey();
		expect((await vapidKeys(key.pem))?.publicKey).toBe(base64Url(key.publicRaw));
	});
});

describe('subscriptions', () => {
	it('takes only the addresses of the known push services', () => {
		for (const endpoint of [
			'https://fcm.googleapis.com/fcm/send/abc:def',
			'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
			'https://web.push.apple.com/QGx0',
			'https://wns2-par02p.notify.windows.com/w/?token=BQYA'
		]) {
			expect(validPushEndpoint(endpoint)).toBe(true);
		}
		for (const endpoint of [
			'http://fcm.googleapis.com/fcm/send/abc',
			'https://fcm.googleapis.com:8443/fcm/send/abc',
			'https://evil.example/fcm.googleapis.com',
			'https://fcm.googleapis.com.evil.example/x',
			'https://user:pw@fcm.googleapis.com/x',
			'https://169.254.169.254/latest/meta-data',
			'not a url'
		]) {
			expect(validPushEndpoint(endpoint)).toBe(false);
		}
	});

	it('checks the size of the browser keys', async () => {
		const { keys } = await browser();
		expect(validSubscriptionKeys(keys)).toBe(true);
		expect(validSubscriptionKeys({ ...keys, auth: base64Url(new Uint8Array(8)) })).toBe(false);
		expect(validSubscriptionKeys({ ...keys, p256dh: 'abc' })).toBe(false);
		expect(validSubscriptionKeys({ ...keys, p256dh: '***' })).toBe(false);
	});
});

describe('sendPush', () => {
	const message = {
		title: 'Fristen: 1 neu',
		body: '10.11.2026: Aufgabe',
		path: '/aufgaben',
		tag: 't'
	};

	it('posts the encrypted message with the VAPID header', async () => {
		const key = await serverKey();
		const vapid = (await vapidKeys(key.pem))!;
		const receiver = await browser();
		const fetch = vi.fn(async () => new Response('', { status: 201 }));
		await sendPush(
			{ endpoint: 'https://web.push.apple.com/QGx0', keys: receiver.keys },
			message,
			vapid,
			{ subject: 'https://app.example.org', urgent: true, fetch }
		);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://web.push.apple.com/QGx0');
		const headers = init.headers as Record<string, string>;
		expect(headers.authorization).toMatch(
			new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`)
		);
		expect(headers['content-encoding']).toBe('aes128gcm');
		expect(headers.urgency).toBe('high');
		expect(init.redirect).toBe('manual');
		const { plain } = await decrypt(init.body as Uint8Array, receiver);
		expect(JSON.parse(new TextDecoder().decode(plain.slice(0, -1)))).toEqual(message);
	});

	it('tells a subscription that is gone from other failures', async () => {
		const vapid = (await vapidKeys((await serverKey()).pem))!;
		const { keys } = await browser();
		const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys };
		const options = { subject: 'https://app.example.org', urgent: false };
		await expect(
			sendPush(subscription, message, vapid, {
				...options,
				fetch: async () => new Response('', { status: 410 })
			})
		).rejects.toBeInstanceOf(PushGoneError);
		await expect(
			sendPush(subscription, message, vapid, {
				...options,
				fetch: async () => new Response('', { status: 429 })
			})
		).rejects.toThrow('Antwort 429');
		// An address of no push service is never asked.
		const fetch = vi.fn();
		await expect(
			sendPush({ ...subscription, endpoint: 'https://example.org/x' }, message, vapid, {
				...options,
				fetch
			})
		).rejects.toThrow(/ungültig/);
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('deviceLabel', () => {
	it('names the device and, off Apple phones and tablets, the browser', () => {
		expect(
			deviceLabel(
				'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
			)
		).toBe('iPhone');
		expect(
			deviceLabel(
				'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
			)
		).toBe('Android (Chrome)');
		expect(
			deviceLabel(
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
			)
		).toBe('Windows (Edge)');
		expect(
			deviceLabel(
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
			)
		).toBe('Mac (Safari)');
		expect(
			deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')
		).toBe('Linux (Firefox)');
		expect(deviceLabel('')).toBe('Gerät');
	});
});
