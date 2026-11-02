import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { getDeadlineMail } from '#lib/server/deadline-mails.ts';
import { notificationChannels } from '#lib/server/db/schema.ts';
import { outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const env = vi.hoisted(() => ({ VAPID_PRIVATE_KEY: '', DEMO: false }));

vi.mock('$app/env/private', () => ({
	get DEMO() {
		return env.DEMO;
	},
	HOSTED: true,
	ORIGIN: '',
	MAIL_TRANSPORT: 'outbox',
	MAIL_API_KEY: '',
	MAIL_FROM: '',
	get VAPID_PRIVATE_KEY() {
		return env.VAPID_PRIVATE_KEY;
	}
}));

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	env.VAPID_PRIVATE_KEY = '';
	env.DEMO = false;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function vapidPem(): Promise<string> {
	const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign'
	])) as CryptoKeyPair;
	const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
	return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(der)))}\n-----END PRIVATE KEY-----`;
}

/** A browser's subscription, as the page reads it from the push manager. */
async function subscription(endpoint = 'https://fcm.googleapis.com/fcm/send/device-1') {
	const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
		'deriveBits'
	])) as CryptoKeyPair;
	const encode = (bytes: Uint8Array) =>
		btoa(String.fromCharCode(...bytes))
			.replaceAll('+', '-')
			.replaceAll('/', '_')
			.replace(/=+$/, '');
	return {
		endpoint,
		p256dh: encode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
		auth: encode(crypto.getRandomValues(new Uint8Array(16)))
	};
}

const url = 'https://mietkartei.example.de/einstellungen/benachrichtigungen';

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, { url, ...options })));
}

describe('einstellungen/benachrichtigungen', () => {
	it('sets the hour and the weekends, and refuses an hour out of range', async () => {
		expect(await run(load)).toMatchObject({
			data: { hour: 7, weekends: false, channels: [], email: 'a@example.org' }
		});
		expect(await run(actions.timing, { form: { hour: '18', weekends: 'on' } })).toEqual({
			data: { timingSaved: true }
		});
		expect(await run(load)).toMatchObject({ data: { hour: 18, weekends: true } });
		expect(await run(actions.timing, { form: { hour: '3' } })).toMatchObject({ fail: 400 });
	});

	it('adds channels with the address of the app, tests and removes them', async () => {
		expect(await run(actions.add, { form: { kind: 'email', urgentOnly: 'on' } })).toEqual({
			data: { added: 'email', secret: undefined }
		});
		const hook = (await run(actions.add, {
			form: { kind: 'webhook', url: 'https://n8n.example.de/webhook/x' }
		})) as { data: { secret: string } };
		expect(hook.data.secret).toMatch(/^whsec_/);
		// The hosted app only posts to https.
		expect(
			await run(actions.add, { form: { kind: 'webhook', url: 'http://192.168.1.2/hook' } })
		).toMatchObject({ fail: 400 });
		expect(await run(actions.add, { form: { kind: 'sms' } })).toMatchObject({ fail: 400 });

		const channels = await db.select().from(notificationChannels);
		expect(channels.map((channel) => channel.origin)).toEqual([
			'https://mietkartei.example.de',
			'https://mietkartei.example.de'
		]);
		const email = channels.find((channel) => channel.kind === 'email');
		expect(email).toMatchObject({ urgentOnly: true, details: true });
		expect(await run(actions.test, { form: { channelId: email?.id ?? '' } })).toEqual({
			data: { tested: true }
		});
		expect(await run(load)).toMatchObject({
			data: { history: [{ summary: 'Test', error: null }] }
		});
		expect(await run(actions.remove, { form: { channelId: email?.id ?? '' } })).toEqual({
			data: { removed: true }
		});
		expect(await run(actions.remove, { form: { channelId: email?.id ?? '' } })).toMatchObject({
			fail: 404
		});
	});

	it('says when a test did not go through or the channel is gone', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('down', { status: 503 }))
		);
		await run(actions.add, { form: { kind: 'webhook', url: 'https://hooks.example.de/handy' } });
		const [channel] = await db.select().from(notificationChannels);
		expect(await run(actions.test, { form: { channelId: channel.id } })).toMatchObject({
			fail: 502,
			data: { refused: 'Der Test ist nicht angekommen: Antwort 503' }
		});
		expect(await run(actions.test, { form: { channelId: 'nonsense' } })).toMatchObject({
			fail: 404
		});
		vi.unstubAllGlobals();
	});

	it('offers Mitteilungen only with the server key, and sends a test to a new device', async () => {
		expect(await run(load)).toMatchObject({ data: { push: { key: null, offered: false } } });
		const browser = await subscription();
		expect(await run(actions.push, { form: browser })).toMatchObject({
			fail: 400,
			data: { refused: 'Mitteilungen sind auf diesem Server nicht eingerichtet.' }
		});

		env.VAPID_PRIVATE_KEY = await vapidPem();
		const loaded = (await run(load)) as { data: { push: { key: string; offered: boolean } } };
		expect(loaded.data.push.offered).toBe(true);
		expect(loaded.data.push.key).toMatch(/^[\w-]{87}$/);

		const fetch = vi.fn(async () => new Response('', { status: 201 }));
		vi.stubGlobal('fetch', fetch);
		expect(await run(actions.push, { form: { ...browser, urgentOnly: 'on' } })).toEqual({
			data: { added: 'push', tested: true }
		});
		expect(fetch).toHaveBeenCalledOnce();
		const [url] = fetch.mock.calls[0] as unknown as [string];
		expect(url).toBe(browser.endpoint);
		const [channel] = await db.select().from(notificationChannels);
		expect(channel).toMatchObject({
			kind: 'push',
			url: browser.endpoint,
			label: 'Gerät',
			urgentOnly: true,
			origin: 'https://mietkartei.example.de'
		});
		expect(JSON.parse(channel.secret ?? '')).toEqual({
			p256dh: browser.p256dh,
			auth: browser.auth
		});

		// The same browser again keeps its channel.
		await run(actions.push, { form: browser });
		expect(await db.select().from(notificationChannels)).toHaveLength(1);

		// Only addresses of push services.
		expect(
			await run(actions.push, { form: { ...browser, endpoint: 'https://169.254.169.254/x' } })
		).toMatchObject({ fail: 400 });
	});

	it('drops a device the push service no longer knows', async () => {
		env.VAPID_PRIVATE_KEY = await vapidPem();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 410 }))
		);
		expect(await run(actions.push, { form: await subscription() })).toMatchObject({ fail: 502 });
		expect(await db.select().from(notificationChannels)).toEqual([]);
	});

	it('refuses a form without a subscription, a failed test and the demo', async () => {
		env.VAPID_PRIVATE_KEY = await vapidPem();
		expect(await run(actions.push, { form: {} })).toMatchObject({
			fail: 400,
			data: { refused: 'Der Browser hat keine gültige Anmeldung für Mitteilungen geliefert.' }
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 503 }))
		);
		expect(await run(actions.push, { form: await subscription() })).toMatchObject({
			fail: 502,
			data: { refused: 'Eingerichtet, aber die Testmitteilung ist nicht angekommen: Antwort 503' }
		});
		env.DEMO = true;
		expect(await run(actions.push, { form: await subscription() })).toMatchObject({
			fail: 400,
			data: { refused: 'In der Demo werden keine Hinweise verschickt.' }
		});
	});

	it('turns the weekly Fristenübersicht on with the address of the app, and off again', async () => {
		expect(await run(load)).toMatchObject({ data: { deadlineMail: { on: false, sentOn: null } } });
		expect(await run(actions.mail, { form: { on: 'true' } })).toEqual({
			data: { mailSaved: true }
		});
		expect(await getDeadlineMail(db, 'user-a')).toEqual({
			origin: 'https://mietkartei.example.de',
			sentOn: null
		});
		expect(await run(actions.mail, { form: { on: 'false' } })).toEqual({
			data: { mailSaved: false }
		});
		expect(await getDeadlineMail(db, 'user-a')).toEqual({ origin: null, sentOn: null });
	});
});
