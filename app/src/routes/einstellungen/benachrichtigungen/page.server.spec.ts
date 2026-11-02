import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { getDeadlineMail } from '#lib/server/deadline-mails.ts';
import { notificationChannels } from '#lib/server/db/schema.ts';
import { outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

vi.mock('$app/env/private', () => ({
	DEMO: false,
	HOSTED: true,
	ORIGIN: '',
	MAIL_TRANSPORT: 'outbox',
	MAIL_API_KEY: '',
	MAIL_FROM: ''
}));

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

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
		await run(actions.add, { form: { kind: 'ntfy', url: 'https://ntfy.sh/haus' } });
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
