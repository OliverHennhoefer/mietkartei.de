// Web Push: the app's own Mitteilungen on a phone or computer, without a third app. The browser
// gives the app an address at its push service (Apple, Google, Mozilla, Microsoft) and two keys
// of its own; the server encrypts each message for that browser alone (RFC 8291) and signs the
// request with its VAPID key (RFC 8292), so the push service sees neither the content nor lets
// anyone else send to the subscription. The VAPID key is the secret VAPID_PRIVATE_KEY; without it
// the app offers no Mitteilungen.

const encoder = new TextEncoder();

export function base64Url(bytes: Uint8Array): string {
	return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
	return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (char) =>
		char.charCodeAt(0)
	);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
}

/** The DER bytes of a PKCS#8 PEM key ("-----BEGIN PRIVATE KEY-----"). */
function pemBytes(pem: string): Uint8Array<ArrayBuffer> {
	const body = pem
		.replace(/\\n/g, '\n')
		.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
		.replace(/\s+/g, '');
	return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

export type VapidKeys = {
	/** The uncompressed P-256 public key, base64url, as the browser's applicationServerKey. */
	publicKey: string;
	privateKey: CryptoKey;
};

let cached: { pem: string; keys: Promise<VapidKeys> } | undefined;

async function importVapid(pem: string): Promise<VapidKeys> {
	const algorithm = { name: 'ECDSA', namedCurve: 'P-256' };
	// Imported once as extractable to read the public point; the signing key is not.
	const extractable = await crypto.subtle.importKey('pkcs8', pemBytes(pem), algorithm, true, [
		'sign'
	]);
	const jwk = await crypto.subtle.exportKey('jwk', extractable);
	if (!jwk.x || !jwk.y) throw new Error('VAPID_PRIVATE_KEY has no public point.');
	const publicKey = concat(new Uint8Array([4]), fromBase64Url(jwk.x), fromBase64Url(jwk.y));
	const privateKey = await crypto.subtle.importKey('pkcs8', pemBytes(pem), algorithm, false, [
		'sign'
	]);
	return { publicKey: base64Url(publicKey), privateKey };
}

/** The keys of VAPID_PRIVATE_KEY (a P-256 key as PKCS#8 PEM), or undefined when it is not set. */
export async function vapidKeys(pem: string): Promise<VapidKeys | undefined> {
	if (!pem.trim()) return undefined;
	if (cached?.pem !== pem) {
		const keys = importVapid(pem);
		cached = { pem, keys };
		// A broken key is tried again with the next call instead of failing for good.
		keys.catch(() => {
			if (cached?.keys === keys) cached = undefined;
		});
	}
	return cached.keys;
}

/**
 * The push services browsers subscribe at. Only their addresses are taken, so nobody can make
 * the server post to an address of their choosing by handing in a made-up subscription.
 */
const pushHosts = [
	/^fcm\.googleapis\.com$/,
	/^android\.googleapis\.com$/,
	/^updates\.push\.services\.mozilla\.com$/,
	/^(web\.)?push\.apple\.com$/,
	/^[a-z0-9-]+\.notify\.windows\.com$/
];

export function validPushEndpoint(endpoint: string): boolean {
	if (endpoint.length > 1000 || !URL.canParse(endpoint)) return false;
	const url = new URL(endpoint);
	return (
		url.protocol === 'https:' &&
		url.port === '' &&
		!url.username &&
		!url.password &&
		pushHosts.some((host) => host.test(url.hostname))
	);
}

export type PushSubscriptionKeys = {
	/** The browser's P-256 public key, uncompressed, base64url. */
	p256dh: string;
	/** The browser's 16-byte authentication secret, base64url. */
	auth: string;
};

export function validSubscriptionKeys(keys: PushSubscriptionKeys): boolean {
	try {
		const p256dh = fromBase64Url(keys.p256dh);
		const auth = fromBase64Url(keys.auth);
		return p256dh.length === 65 && p256dh[0] === 4 && auth.length === 16;
	} catch {
		return false;
	}
}

/** The VAPID JWT for one push service, valid for 12 hours (the services allow up to 24). */
export async function vapidToken(
	endpoint: string,
	keys: VapidKeys,
	subject: string,
	nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> {
	const header = base64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
	const claims = base64Url(
		encoder.encode(
			JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: subject })
		)
	);
	const input = `${header}.${claims}`;
	// WebCrypto signs ECDSA as r || s, the form JWS wants.
	const signature = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		keys.privateKey,
		encoder.encode(input)
	);
	return `${input}.${base64Url(new Uint8Array(signature))}`;
}

async function hkdf(
	salt: Uint8Array<ArrayBuffer>,
	ikm: Uint8Array<ArrayBuffer>,
	info: Uint8Array<ArrayBuffer>,
	bytes: number
): Promise<Uint8Array<ArrayBuffer>> {
	const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
	return new Uint8Array(
		await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8)
	);
}

/** One record of 4096 bytes holds every message the app sends. */
const RECORD_SIZE = 4096;

/**
 * Encrypts a message for one browser as `aes128gcm` (RFC 8291, RFC 8188), in a single record.
 * The sender's key pair and the salt are new for every message; tests pass fixed ones.
 */
export async function encryptPush(
	plaintext: Uint8Array,
	subscription: PushSubscriptionKeys,
	fixed?: { senderKeys: CryptoKeyPair; salt: Uint8Array<ArrayBuffer> }
): Promise<Uint8Array<ArrayBuffer>> {
	const receiverPublic = fromBase64Url(subscription.p256dh);
	const authSecret = fromBase64Url(subscription.auth);
	const sender =
		fixed?.senderKeys ??
		((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
			'deriveBits'
		])) as CryptoKeyPair);
	const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
	const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
	const receiverKey = await crypto.subtle.importKey(
		'raw',
		receiverPublic,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);
	const shared = new Uint8Array(
		await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, sender.privateKey, 256)
	);
	const keyInfo = concat(encoder.encode('WebPush: info\0'), receiverPublic, senderPublic);
	const ikm = await hkdf(authSecret, shared, keyInfo, 32);
	const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
	const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
	// The delimiter 2 marks the last (and only) record; no padding.
	const record = concat(plaintext, new Uint8Array([2]));
	if (record.length + 16 > RECORD_SIZE) throw new Error('The push message is too long.');
	const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record)
	);
	const header = new Uint8Array(16 + 4 + 1 + senderPublic.length);
	header.set(salt, 0);
	new DataView(header.buffer).setUint32(16, RECORD_SIZE);
	header[20] = senderPublic.length;
	header.set(senderPublic, 21);
	return concat(header, ciphertext);
}

/** What the service worker shows; see src/service-worker.ts. */
export type PushMessage = {
	title: string;
	body: string;
	/** A path of the app, opened on a tap. */
	path: string;
	/** Mitteilungen with the same tag replace each other. */
	tag: string;
};

/** The subscription is gone (unsubscribed, expired, the app removed): the channel is of no use. */
export class PushGoneError extends Error {
	constructor() {
		super('Auf diesem Gerät abgemeldet.');
		this.name = 'PushGoneError';
	}
}

/** Sends one message; throws with a German reason when the push service does not take it. */
export async function sendPush(
	subscription: { endpoint: string; keys: PushSubscriptionKeys },
	message: PushMessage,
	vapid: VapidKeys,
	options: { subject: string; urgent: boolean; fetch?: typeof fetch }
): Promise<void> {
	if (!validPushEndpoint(subscription.endpoint)) throw new Error('Die Push-Adresse ist ungültig.');
	const body = await encryptPush(encoder.encode(JSON.stringify(message)), subscription.keys);
	const token = await vapidToken(subscription.endpoint, vapid, options.subject);
	let response: Response;
	try {
		response = await (options.fetch ?? fetch)(subscription.endpoint, {
			method: 'POST',
			headers: {
				authorization: `vapid t=${token}, k=${vapid.publicKey}`,
				'content-encoding': 'aes128gcm',
				'content-type': 'application/octet-stream',
				// A Hinweis waits up to four weeks for a device that is off, not longer.
				ttl: String(28 * 24 * 3600),
				urgency: options.urgent ? 'high' : 'normal',
				topic: message.tag
			},
			body,
			redirect: 'manual',
			signal: AbortSignal.timeout(10_000)
		});
	} catch (error) {
		throw new Error(
			`Nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200),
			{ cause: error }
		);
	}
	await response.body?.cancel();
	if (response.status === 404 || response.status === 410) throw new PushGoneError();
	if (!response.ok) throw new Error(`Antwort ${response.status}`);
}

/**
 * A short name for the device of a browser, from its user agent, so a user with a phone and a
 * computer tells their channels apart: "iPhone", "Android (Chrome)", "Mac (Safari)".
 */
export function deviceLabel(userAgent: string): string {
	const device = /iPhone/.test(userAgent)
		? 'iPhone'
		: /iPad/.test(userAgent)
			? 'iPad'
			: /Android/.test(userAgent)
				? 'Android'
				: /Windows/.test(userAgent)
					? 'Windows'
					: /Macintosh|Mac OS X/.test(userAgent)
						? 'Mac'
						: /Linux|CrOS/.test(userAgent)
							? 'Linux'
							: 'Gerät';
	if (device === 'iPhone' || device === 'iPad') return device;
	const browser = /Edg\//.test(userAgent)
		? 'Edge'
		: /Firefox\//.test(userAgent)
			? 'Firefox'
			: /OPR\/|Opera/.test(userAgent)
				? 'Opera'
				: /SamsungBrowser/.test(userAgent)
					? 'Samsung Internet'
					: /Chrome\//.test(userAgent)
						? 'Chrome'
						: /Safari\//.test(userAgent)
							? 'Safari'
							: undefined;
	return browser ? `${device} (${browser})` : device;
}
