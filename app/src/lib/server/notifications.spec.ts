import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEntry } from './calendar';
import type { Database } from './db';
import {
	notificationChannels,
	notificationDeliveries,
	notificationStates,
	outbox,
	tasks,
	users
} from './db/schema';
import {
	addChannel,
	dueNotices,
	findEntry,
	getNotificationSettings,
	MAX_FAILURES,
	noticeMail,
	noticesDue,
	ntfyMessage,
	ntfyTarget,
	removeChannel,
	sendDueNotifications,
	snooze,
	stageOf,
	testChannel,
	validChannelUrl,
	webhookPayload,
	webhookSignature,
	type NotificationState
} from './notifications';
import { contextA, contextB, testDatabase } from './testing';

vi.mock('$app/env/private', () => ({ MAIL_TRANSPORT: 'outbox', MAIL_API_KEY: '', MAIL_FROM: '' }));

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const ORIGIN = 'https://app.example.org';

/** 8 o'clock in Germany on the day (an hour ahead of UTC in winter). */
const morning = (date: string) => new Date(`${date}T07:00:00Z`);

function entry(overrides: Partial<CalendarEntry> = {}): CalendarEntry {
	return {
		uid: 'task-1@mietkartei.de',
		key: 'task-1',
		kind: 'task',
		date: '2026-11-10',
		title: 'Rauchmelder prüfen',
		overdue: false,
		summary: 'Rauchmelder prüfen',
		url: `${ORIGIN}/aufgaben?bearbeiten=1`,
		...overrides
	};
}

async function task(accountId: string, title: string, dueDate: string) {
	const [row] = await db
		.insert(tasks)
		.values({ accountId, title, dueDate })
		.returning({ id: tasks.id });
	return row.id;
}

describe('stageOf', () => {
	it('tells a task a week ahead and once it is overdue', () => {
		expect(stageOf(entry({ date: '2026-11-10' }), '2026-11-02')).toBe(null);
		expect(stageOf(entry({ date: '2026-11-10' }), '2026-11-03')).toBe('lead');
		expect(stageOf(entry({ date: '2026-11-10' }), '2026-11-09')).toBe('lead');
		expect(stageOf(entry({ date: '2026-11-01', overdue: true }), '2026-11-02')).toBe('overdue');
	});

	it('tells a statement six weeks ahead and again three days before', () => {
		const statement = entry({ kind: 'statement', date: '2026-12-31' });
		expect(stageOf(statement, '2026-11-18')).toBe(null);
		expect(stageOf(statement, '2026-11-19')).toBe('lead');
		expect(stageOf(statement, '2026-12-27')).toBe('lead');
		expect(stageOf(statement, '2026-12-28')).toBe('soon');
	});

	it('drops an informing deadline once its date has passed', () => {
		expect(stageOf(entry({ kind: 'graduated_step', date: '2026-11-01' }), '2026-11-02')).toBe(null);
	});
});

describe('dueNotices', () => {
	const states = (rows: Record<string, NotificationState>) => new Map(Object.entries(rows));

	it('tells each stage once and starts over when the date moves', () => {
		const rows = [entry()];
		expect(dueNotices(rows, states({}), '2026-11-05')).toEqual([{ entry: rows[0], stage: 'lead' }]);
		const told = states({ 'task-1': { date: '2026-11-10', stage: 'lead', snoozedUntil: null } });
		expect(dueNotices(rows, told, '2026-11-06')).toEqual([]);
		expect(dueNotices([entry({ date: '2026-11-12' })], told, '2026-11-06')).toHaveLength(1);
		expect(
			dueNotices([entry({ date: '2026-11-04', overdue: true })], told, '2026-11-06')
		).toHaveLength(1);
	});

	it('skips a snoozed entry until the snooze ends', () => {
		const snoozed = states({
			'task-1': { date: '2026-11-10', stage: null, snoozedUntil: '2026-11-08' }
		});
		expect(dueNotices([entry()], snoozed, '2026-11-07')).toEqual([]);
		expect(dueNotices([entry()], snoozed, '2026-11-08')).toHaveLength(1);
	});

	it('puts the overdue ones first, then by date', () => {
		const notices = dueNotices(
			[
				entry({ key: 'a', date: '2026-11-09' }),
				entry({ key: 'b', date: '2026-11-01', overdue: true }),
				entry({ key: 'c', date: '2026-11-05' })
			],
			states({}),
			'2026-11-04'
		);
		expect(notices.map((notice) => notice.entry.key)).toEqual(['b', 'c', 'a']);
	});
});

describe('the messages', () => {
	const notices = [
		{
			entry: entry({ key: 'task-2', date: '2026-11-01', overdue: true, title: 'Heizung warten' }),
			stage: 'overdue' as const
		},
		{ entry: entry({ description: 'Müller · EG links' }), stage: 'lead' as const }
	];

	it('mail the stages with links to the matter and to snooze it', () => {
		const mail = noticeMail({ email: 'a@example.org', name: 'Katrin' }, notices, ORIGIN);
		expect(mail.subject).toBe('Fristen: 1 überfällig, 1 neu | mietkartei');
		expect(mail.text).toContain(
			'Überfällig\n\n- 01.11.2026: Heizung warten\n  https://app.example.org/aufgaben?bearbeiten=1\n' +
				'  Später erinnern oder erledigt: https://app.example.org/erinnerung/task-2'
		);
		expect(mail.text).toContain('Neu anstehend\n\n- 10.11.2026: Rauchmelder prüfen\n  Müller');
	});

	it('leave tenant names out of a push and a webhook unless asked for', () => {
		const push = ntfyMessage('topic', notices, false, ORIGIN);
		expect(push).toMatchObject({
			topic: 'topic',
			title: 'Fristen: 1 überfällig, 1 neu',
			priority: 4
		});
		expect(push.message).toBe(
			'01.11.2026: Heizung warten (überfällig)\n10.11.2026: Rauchmelder prüfen'
		);
		expect(ntfyMessage('topic', notices, true, ORIGIN).message).toContain('Müller');

		const now = new Date('2026-11-02T07:00:00Z');
		const payload = webhookPayload(notices, false, now);
		expect(payload).toMatchObject({ version: 1, event: 'notices', summary: '1 überfällig, 1 neu' });
		expect(payload.notices[1]).toEqual({
			id: 'task-1',
			kind: 'task',
			stage: 'lead',
			urgent: false,
			date: '2026-11-10',
			title: 'Rauchmelder prüfen',
			url: `${ORIGIN}/aufgaben?bearbeiten=1`
		});
		expect(webhookPayload(notices, true, now).notices[1].detail).toBe('Müller · EG links');
	});

	it('signs a webhook like the receivers expect', async () => {
		const now = new Date('2026-11-02T07:00:00Z');
		const signature = await webhookSignature('whsec_test', '{"a":1}', now);
		const key = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode('whsec_test'),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['verify']
		);
		const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signature) ?? [];
		expect(t).toBe(String(now.getTime() / 1000));
		const mac = Uint8Array.from(v1.match(/../g) ?? [], (byte) => parseInt(byte, 16));
		expect(
			await crypto.subtle.verify('HMAC', key, mac, new TextEncoder().encode(`${t}.{"a":1}`))
		).toBe(true);
	});
});

describe('channel addresses', () => {
	it('reads the server and topic of an ntfy address', () => {
		expect(ntfyTarget('https://ntfy.sh/mietkartei-x7')).toEqual({
			server: 'https://ntfy.sh',
			topic: 'mietkartei-x7'
		});
		expect(ntfyTarget('https://push.example.de/ntfy/haus')).toEqual({
			server: 'https://push.example.de/ntfy',
			topic: 'haus'
		});
		expect(ntfyTarget('https://ntfy.sh/')).toBeUndefined();
		expect(ntfyTarget('https://ntfy.sh/a b')).toBeUndefined();
	});

	it('takes https, and http only where allowed', () => {
		expect(validChannelUrl('webhook', 'https://n8n.example.de/webhook/x', false)).toBe(true);
		expect(validChannelUrl('webhook', 'http://homeassistant.local:8123/api/webhook/x', false)).toBe(
			false
		);
		expect(validChannelUrl('webhook', 'http://homeassistant.local:8123/api/webhook/x', true)).toBe(
			true
		);
		expect(validChannelUrl('webhook', 'https://user:pw@example.de/', false)).toBe(false);
		expect(validChannelUrl('webhook', 'ftp://example.de/', true)).toBe(false);
		expect(validChannelUrl('ntfy', 'https://ntfy.sh/', false)).toBe(false);
	});
});

describe('noticesDue', () => {
	const user = { notificationHour: 7, notificationWeekends: false, checkedOn: null };

	it('waits for the hour, once a day, and for Monday without weekends', () => {
		// Monday, 2 November 2026; Germany is an hour ahead of UTC.
		expect(noticesDue(user, new Date('2026-11-02T05:59:00Z'))).toBe(false);
		expect(noticesDue(user, new Date('2026-11-02T06:00:00Z'))).toBe(true);
		expect(noticesDue({ ...user, checkedOn: '2026-11-02' }, morning('2026-11-02'))).toBe(false);
		expect(noticesDue(user, morning('2026-11-07'))).toBe(false);
		expect(noticesDue({ ...user, notificationWeekends: true }, morning('2026-11-07'))).toBe(true);
	});
});

describe('channels', () => {
	it('adds mail once, gives a webhook a secret and keeps to the limit', async () => {
		expect(
			await addChannel(
				db,
				contextA,
				{ kind: 'email', urgentOnly: false, details: false },
				ORIGIN,
				false
			)
		).toMatchObject({ ok: true });
		expect(
			await addChannel(
				db,
				contextA,
				{ kind: 'email', urgentOnly: true, details: false },
				ORIGIN,
				false
			)
		).toEqual({ ok: false, reason: 'email-exists' });
		const hook = await addChannel(
			db,
			contextA,
			{ kind: 'webhook', url: 'https://n8n.example.de/x', urgentOnly: false, details: true },
			ORIGIN,
			false
		);
		expect(hook).toMatchObject({ ok: true, secret: expect.stringMatching(/^whsec_/) });
		expect(
			await addChannel(
				db,
				contextA,
				{ kind: 'ntfy', url: 'http://ntfy.sh/x', urgentOnly: true, details: false },
				ORIGIN,
				false
			)
		).toEqual({ ok: false, reason: 'url' });
		const settings = await getNotificationSettings(db, 'user-a');
		expect(settings.channels.map((channel) => channel.kind)).toEqual(['email', 'webhook']);
		// The secret never goes to the page.
		expect(settings.channels.every((channel) => !('secret' in channel))).toBe(true);
		expect(settings.channels.map((channel) => channel.hasSecret)).toEqual([false, true]);

		// Another user cannot remove or test it.
		const id = settings.channels[0].id;
		expect(await removeChannel(db, contextB, id)).toBe(false);
		expect(await testChannel(db, contextB, id, { email: 'b@example.org', name: null })).toBe(
			undefined
		);
		expect(await removeChannel(db, contextA, id)).toBe(true);
	});

	it('resumes a paused channel when a test goes through', async () => {
		const added = await addChannel(
			db,
			contextA,
			{ kind: 'ntfy', url: 'https://ntfy.sh/haus', urgentOnly: false, details: false },
			ORIGIN,
			false
		);
		if (!added.ok) throw new Error('not added');
		await db
			.update(notificationChannels)
			.set({ failures: MAX_FAILURES, lastError: 'Antwort 500' })
			.where(eq(notificationChannels.id, added.id));
		const fetch = vi.fn(async () => new Response('{}'));
		vi.stubGlobal('fetch', fetch);
		expect(
			await testChannel(db, contextA, added.id, { email: 'a@example.org', name: null })
		).toEqual({ ok: true });
		const [request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(request).toBe('https://ntfy.sh');
		const [channel] = await db.select().from(notificationChannels);
		expect(channel).toMatchObject({ failures: 0, lastError: null });
	});
});

describe('sendDueNotifications', () => {
	it('tells each stage once, at the user’s hour, on every channel by its urgency', async () => {
		await addChannel(
			db,
			contextA,
			{ kind: 'email', urgentOnly: false, details: false },
			ORIGIN,
			false
		);
		await addChannel(
			db,
			contextA,
			{ kind: 'webhook', url: 'https://hook.example.de/in', urgentOnly: true, details: false },
			ORIGIN,
			false
		);
		const fetch = vi.fn(async () => new Response('ok'));
		vi.stubGlobal('fetch', fetch);
		await task('a', 'Rauchmelder prüfen', '2026-11-06');
		// Account b has no channel and is never looked at.
		await task('b', 'Heizung warten', '2026-11-06');

		expect(await sendDueNotifications(db, new Date('2026-11-02T05:00:00Z'))).toBe(0);
		// The task is due within the week: told by mail, not on the urgent-only webhook.
		expect(await sendDueNotifications(db, morning('2026-11-02'))).toBe(1);
		expect(fetch).not.toHaveBeenCalled();
		const [mail] = await db.select().from(outbox);
		expect(mail).toMatchObject({ to: 'a@example.org', subject: 'Fristen: 1 neu | mietkartei' });
		// Once a day, and the stage only once.
		expect(await sendDueNotifications(db, new Date('2026-11-02T15:00:00Z'))).toBe(0);
		expect(await sendDueNotifications(db, morning('2026-11-03'))).toBe(0);

		// Overdue: urgent, so both channels hear of it.
		expect(await sendDueNotifications(db, morning('2026-11-09'))).toBe(2);
		const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		const payload = JSON.parse(String(init.body));
		expect(payload).toMatchObject({ event: 'notices', summary: '1 überfällig' });
		expect(payload.notices[0]).toMatchObject({ stage: 'overdue', title: 'Rauchmelder prüfen' });
		expect(new Headers(init.headers).get('x-mietkartei-signature')).toMatch(/^t=\d+,v1=/);
		expect(await db.select().from(outbox)).toHaveLength(2);
		expect(await db.select().from(notificationDeliveries)).toHaveLength(3);
		expect(await sendDueNotifications(db, morning('2026-11-10'))).toBe(0);
	});

	it('counts the failures of a channel, pauses it and tries a day again when all failed', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await addChannel(
			db,
			contextA,
			{ kind: 'ntfy', url: 'https://ntfy.sh/haus', urgentOnly: false, details: false },
			ORIGIN,
			false
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('down', { status: 502 }))
		);
		await task('a', 'Rauchmelder prüfen', '2026-11-06');
		expect(await sendDueNotifications(db, morning('2026-11-02'))).toBe(0);
		const [user] = await db
			.select({ checkedOn: users.notificationsCheckedOn })
			.from(users)
			.where(eq(users.id, 'user-a'));
		expect(user.checkedOn).toBe(null);
		for (let hour = 8; hour < 8 + MAX_FAILURES; hour += 1) {
			await sendDueNotifications(
				db,
				new Date(`2026-11-02T${String(hour).padStart(2, '0')}:00:00Z`)
			);
		}
		const [channel] = await db.select().from(notificationChannels);
		expect(channel).toMatchObject({ failures: MAX_FAILURES, lastError: 'Antwort 502' });
		// Paused: no more tries.
		expect(await db.select().from(notificationDeliveries)).toHaveLength(MAX_FAILURES);
		await sendDueNotifications(db, new Date('2026-11-02T20:00:00Z'));
		expect(await db.select().from(notificationDeliveries)).toHaveLength(MAX_FAILURES);
	});

	it('retries when the channel that had something failed, though an urgent-only one had nothing', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await addChannel(
			db,
			contextA,
			{ kind: 'webhook', url: 'https://hook.example.de/all', urgentOnly: false, details: false },
			ORIGIN,
			false
		);
		await addChannel(
			db,
			contextA,
			{ kind: 'ntfy', url: 'https://ntfy.sh/haus', urgentOnly: true, details: false },
			ORIGIN,
			false
		);
		const fetch = vi.fn(async () => new Response('down', { status: 503 }));
		vi.stubGlobal('fetch', fetch);
		await task('a', 'Rauchmelder prüfen', '2026-11-06');
		expect(await sendDueNotifications(db, morning('2026-11-02'))).toBe(0);
		expect(await db.select().from(notificationStates)).toHaveLength(0);
		fetch.mockImplementation(async () => new Response('ok'));
		expect(await sendDueNotifications(db, new Date('2026-11-02T08:00:00Z'))).toBe(1);
		expect(await db.select().from(notificationStates)).toHaveLength(1);
	});

	it('keeps the state of an entry still open long after its date, and drops those gone', async () => {
		await addChannel(
			db,
			contextA,
			{ kind: 'email', urgentOnly: false, details: false },
			ORIGIN,
			false
		);
		await task('a', 'Dachrinne reinigen', '2025-01-10');
		await db.insert(notificationStates).values({
			accountId: 'a',
			userId: 'user-a',
			entry: 'task-gone',
			date: '2025-01-10',
			stage: 'overdue',
			updatedAt: new Date()
		});
		expect(await sendDueNotifications(db, morning('2026-11-02'))).toBe(1);
		expect(await sendDueNotifications(db, morning('2026-11-03'))).toBe(0);
		expect(await sendDueNotifications(db, morning('2026-11-04'))).toBe(0);
		const states = await db.select().from(notificationStates);
		expect(states.map((state) => state.stage)).toEqual(['overdue']);
		expect(states[0].entry).not.toBe('task-gone');
	});

	it('holds back a snoozed entry until the snooze ends', async () => {
		await addChannel(
			db,
			contextA,
			{ kind: 'email', urgentOnly: false, details: false },
			ORIGIN,
			false
		);
		const id = await task('a', 'Rauchmelder prüfen', '2026-11-06');
		const found = await findEntry(db, 'a', `task-${id}`, ORIGIN, '2026-11-02');
		if (!found) throw new Error('not found');
		expect(await findEntry(db, 'b', `task-${id}`, ORIGIN, '2026-11-02')).toBeUndefined();
		await snooze(db, { accountId: 'a', userId: 'user-a' }, found, '2026-11-05');
		expect(await sendDueNotifications(db, morning('2026-11-02'))).toBe(0);
		expect(await sendDueNotifications(db, morning('2026-11-05'))).toBe(1);
		const [state] = await db.select().from(notificationStates);
		expect(state).toMatchObject({ stage: 'lead', snoozedUntil: null });
	});
});
