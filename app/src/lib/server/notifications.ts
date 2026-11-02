import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { addDays, daysBetween, dayOf, formatDate, weekday, type IsoDate } from '../dates';
import { auditEntry, type AuditContext } from './audit';
import { generateToken } from './auth';
import { calendarEntries, type CalendarEntry } from './calendar';
import type { Database } from './db';
import { chunk, chunkIds, rowsPerStatement, runBatch } from './db/batch';
import {
	notificationChannels,
	notificationDeliveries,
	notificationStates,
	users,
	type NotificationChannelKind,
	type NotificationStage
} from './db/schema';
import type { DeadlineKind } from './deadlines';
import { sendMail, type Mail } from './mail';

// Hinweise: the app tells a user about a deadline or task by itself, at most three times per
// entry: some time ahead (lead), shortly before a statutory deadline (soon) and once it is overdue.
// What was told is remembered per user and entry, so a stage is never told twice, and everything
// of a day goes out together, at the hour the user chose and, if they wish, not at weekends. The
// channels are the user's own mail address, an ntfy topic and webhooks. The job runs every hour,
// started like the Fristenübersicht (see jobs.ts).

/** Failed sends in a row after which a channel is paused until a test goes through. */
export const MAX_FAILURES = 5;

/** Channels a user may add. */
export const MAX_CHANNELS = 5;

/** Days before a statutory deadline that its urgent Hinweis goes out. */
export const SOON_DAYS = 3;

/** The hours a user may choose for the day's Hinweise. */
export const NOTIFICATION_HOURS = { min: 6, max: 21 } as const;

/** How many entries a push names before it only counts the rest. */
const PUSH_ENTRIES = 8;

type Rule = { lead: number; soon: boolean };

/**
 * When each kind is told ahead (days) and whether it gets the urgent Hinweis shortly before. The
 * long leads are for what takes preparation: a statement, notice to an insurer, a rent increase.
 */
export const notificationRules: Record<DeadlineKind | 'task', Rule> = {
	statement: { lead: 42, soon: true },
	objection: { lead: 7, soon: false },
	lease_end: { lead: 30, soon: true },
	deposit_instalment: { lead: 7, soon: false },
	deposit_return: { lead: 30, soon: true },
	graduated_step: { lead: 30, soon: false },
	index_proposal: { lead: 14, soon: false },
	comparative_possible: { lead: 14, soon: false },
	comparative_consent: { lead: 14, soon: true },
	co2_reimbursement: { lead: 30, soon: true },
	meter_reading: { lead: 7, soon: true },
	insurance_notice: { lead: 28, soon: true },
	insurance_end: { lead: 28, soon: false },
	task: { lead: 7, soon: false }
};

const stageRank: Record<NotificationStage, number> = { lead: 1, soon: 2, overdue: 3 };

export const stageLabels: Record<NotificationStage, string> = {
	lead: 'Neu anstehend',
	soon: 'In den nächsten Tagen fällig',
	overdue: 'Überfällig'
};

export const channelKindLabels: Record<NotificationChannelKind, string> = {
	email: 'E-Mail',
	ntfy: 'ntfy',
	webhook: 'Webhook'
};

/** The stage an entry is in on `today`, or null while it is too far ahead (or passed and informal). */
export function stageOf(entry: Pick<CalendarEntry, 'kind' | 'date' | 'overdue'>, today: IsoDate) {
	if (entry.overdue) return 'overdue' as const;
	const days = daysBetween(today, entry.date);
	if (days < 0) return null;
	const rule = notificationRules[entry.kind];
	if (rule.soon && days <= SOON_DAYS) return 'soon' as const;
	if (days <= rule.lead) return 'lead' as const;
	return null;
}

export const isUrgent = (stage: NotificationStage) => stage !== 'lead';

export type NotificationState = {
	date: IsoDate;
	stage: NotificationStage | null;
	snoozedUntil: IsoDate | null;
};

export type Notice = { entry: CalendarEntry; stage: NotificationStage };

/**
 * The entries to tell about on `today`: those whose stage is later than the one last told for the
 * same date, and not snoozed. Overdue ones first, then by date.
 */
export function dueNotices(
	entries: CalendarEntry[],
	states: Map<string, NotificationState>,
	today: IsoDate
): Notice[] {
	const notices: Notice[] = [];
	for (const entry of entries) {
		const stage = stageOf(entry, today);
		if (!stage) continue;
		const state = states.get(entry.key);
		const current = state && state.date === entry.date ? state : undefined;
		if (current?.snoozedUntil && today < current.snoozedUntil) continue;
		if (current?.stage && stageRank[current.stage] >= stageRank[stage]) continue;
		notices.push({ entry, stage });
	}
	return notices.sort(
		(a, b) => stageRank[b.stage] - stageRank[a.stage] || a.entry.date.localeCompare(b.entry.date)
	);
}

/** "1 überfällig, 2 bald fällig, 3 neu", the subject and the history line of a send. */
export function noticeSummary(notices: Notice[]): string {
	const count = (stage: NotificationStage) => notices.filter((n) => n.stage === stage).length;
	return [
		[count('overdue'), 'überfällig'] as const,
		[count('soon'), 'bald fällig'] as const,
		[count('lead'), 'neu'] as const
	]
		.filter(([n]) => n > 0)
		.map(([n, label]) => `${n} ${label}`)
		.join(', ');
}

/** The page that snoozes an entry, or marks a task done. */
export const reminderPath = (key: string) => `/erinnerung/${key}`;

type Recipient = { email: string; name: string | null };

/** The mail of a day's Hinweise, grouped by stage, each with its link and one to snooze it. */
export function noticeMail(recipient: Recipient, notices: Notice[], origin: string): Mail {
	const line = ({ entry }: Notice) =>
		[
			`- ${formatDate(entry.date)}: ${entry.title}`,
			...(entry.description ? [`  ${entry.description}`] : []),
			`  ${entry.url}`,
			`  Später erinnern${entry.kind === 'task' ? ' oder erledigt' : ''}: ${origin}${reminderPath(entry.key)}`
		].join('\n');
	const sections = (['overdue', 'soon', 'lead'] as const).flatMap((stage) => {
		const rows = notices.filter((notice) => notice.stage === stage);
		return rows.length > 0 ? [`${stageLabels[stage]}\n\n${rows.map(line).join('\n\n')}`] : [];
	});
	const paragraphs = [
		recipient.name ? `Hallo ${recipient.name},` : 'Hallo,',
		'in deiner Mietkartei hat sich bei diesen Fristen und Aufgaben etwas getan:',
		...sections,
		'Zu jeder Frist kommt höchstens dreimal ein Hinweis: wenn sie ansteht, kurz vorher und wenn sie überfällig ist.',
		`Einstellen oder abbestellen: ${origin}/einstellungen/benachrichtigungen`
	];
	return {
		to: recipient.email,
		subject: `Fristen: ${noticeSummary(notices)} | mietkartei`,
		text: `${paragraphs.join('\n\n')}\n`
	};
}

/** What a webhook receives, by version 1 of the format. */
export type WebhookPayload = {
	version: 1;
	event: 'notices' | 'test';
	sentAt: string;
	summary: string;
	notices: {
		id: string;
		kind: DeadlineKind | 'task';
		stage: NotificationStage;
		urgent: boolean;
		date: IsoDate;
		title: string;
		detail?: string;
		url: string;
	}[];
};

export function webhookPayload(
	notices: Notice[],
	details: boolean,
	now: Date,
	event: WebhookPayload['event'] = 'notices'
): WebhookPayload {
	return {
		version: 1,
		event,
		sentAt: now.toISOString(),
		summary: event === 'test' ? 'Test' : noticeSummary(notices),
		notices: notices.map(({ entry, stage }) => ({
			id: entry.key,
			kind: entry.kind,
			stage,
			urgent: isUrgent(stage),
			date: entry.date,
			title: entry.title,
			...(details && entry.description ? { detail: entry.description } : {}),
			url: entry.url
		}))
	};
}

const encoder = new TextEncoder();

/** The signature header of a webhook: `t=<seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export async function webhookSignature(secret: string, body: string, now: Date): Promise<string> {
	const timestamp = Math.floor(now.getTime() / 1000);
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const mac = new Uint8Array(
		await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`))
	);
	const hex = Array.from(mac, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `t=${timestamp},v1=${hex}`;
}

/** The server and the topic of an ntfy address such as https://ntfy.sh/mietkartei-x7. */
export function ntfyTarget(url: string): { server: string; topic: string } | undefined {
	const parsed = URL.canParse(url) ? new URL(url) : undefined;
	if (!parsed) return undefined;
	const parts = parsed.pathname.split('/').filter(Boolean);
	const topic = parts.pop();
	if (!topic || !/^[-\w]{1,64}$/.test(topic)) return undefined;
	const base = parts.length > 0 ? `/${parts.join('/')}` : '';
	return { server: `${parsed.origin}${base}`, topic };
}

/** The JSON an ntfy server publishes (docs.ntfy.sh, "Publish as JSON"). */
export function ntfyMessage(
	topic: string,
	notices: Notice[],
	details: boolean,
	origin: string,
	test = false
) {
	if (test) {
		return {
			topic,
			title: 'mietkartei: Test',
			message: 'Hinweise zu Fristen und Aufgaben kommen hier an.',
			tags: ['calendar'],
			click: `${origin}/einstellungen/benachrichtigungen`
		};
	}
	const shown = notices.slice(0, PUSH_ENTRIES);
	const lines = shown.map(({ entry, stage }) => {
		const mark = stage === 'overdue' ? ' (überfällig)' : '';
		const detail = details && entry.description ? `, ${entry.description}` : '';
		return `${formatDate(entry.date)}: ${entry.title}${mark}${detail}`;
	});
	if (notices.length > shown.length) lines.push(`und ${notices.length - shown.length} weitere`);
	const single = notices.length === 1 ? notices[0].entry.url : `${origin}/aufgaben`;
	return {
		topic,
		title: `Fristen: ${noticeSummary(notices)}`,
		message: lines.join('\n'),
		tags: [notices.some((notice) => isUrgent(notice.stage)) ? 'warning' : 'calendar'],
		priority: notices.some((notice) => isUrgent(notice.stage)) ? 4 : 3,
		click: single,
		actions: [{ action: 'view', label: 'Öffnen', url: single, clear: true }]
	};
}

export type Channel = typeof notificationChannels.$inferSelect;

/** Sends to one channel; throws with a German reason when it does not go through. */
async function deliver(
	channel: Channel,
	recipient: Recipient,
	notices: Notice[],
	db: Database,
	now: Date,
	test = false
): Promise<void> {
	if (channel.kind === 'email') {
		await sendMail(
			db,
			test
				? {
						to: recipient.email,
						subject: 'Test: Hinweise zu Fristen | mietkartei',
						text: `Hinweise zu Fristen und Aufgaben kommen hier an.\n\nEinstellungen: ${channel.origin}/einstellungen/benachrichtigungen\n`
					}
				: noticeMail(recipient, notices, channel.origin)
		);
		return;
	}
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'user-agent': 'mietkartei'
	};
	let url: string;
	let body: string;
	if (channel.kind === 'ntfy') {
		const target = channel.url ? ntfyTarget(channel.url) : undefined;
		if (!target) throw new Error('Die ntfy-Adresse ist ungültig.');
		url = target.server;
		body = JSON.stringify(
			ntfyMessage(target.topic, notices, channel.details, channel.origin, test)
		);
		if (channel.secret) headers.authorization = `Bearer ${channel.secret}`;
	} else {
		if (!channel.url || !channel.secret) throw new Error('Der Webhook ist unvollständig.');
		url = channel.url;
		body = JSON.stringify(webhookPayload(notices, channel.details, now, test ? 'test' : 'notices'));
		headers['x-mietkartei-signature'] = await webhookSignature(channel.secret, body, now);
	}
	let response: Response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers,
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
	// The body is not needed; reading it frees the connection.
	await response.body?.cancel();
	if (!response.ok) throw new Error(`Antwort ${response.status}`);
}

/** Sends to the channel and keeps the outcome: its failures, last error and the history row. */
async function deliverAndRecord(
	db: Database,
	channel: Channel,
	recipient: Recipient,
	notices: Notice[],
	now: Date,
	test = false
): Promise<boolean> {
	const summary = test ? 'Test' : noticeSummary(notices);
	try {
		await deliver(channel, recipient, notices, db, now, test);
	} catch (error) {
		const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
		await runBatch(db, [
			db
				.update(notificationChannels)
				.set({ failures: sql`${notificationChannels.failures} + 1`, lastError: message })
				.where(eq(notificationChannels.id, channel.id)),
			db.insert(notificationDeliveries).values({
				accountId: channel.accountId,
				userId: channel.userId,
				channelId: channel.id,
				summary,
				error: message,
				createdAt: now
			})
		]);
		return false;
	}
	await runBatch(db, [
		db
			.update(notificationChannels)
			.set({ failures: 0, lastError: null, lastSentAt: now })
			.where(eq(notificationChannels.id, channel.id)),
		db.insert(notificationDeliveries).values({
			accountId: channel.accountId,
			userId: channel.userId,
			channelId: channel.id,
			summary,
			createdAt: now
		})
	]);
	return true;
}

const berlinHour = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Berlin',
	hour: 'numeric',
	hourCycle: 'h23'
});

/** Whether the user's Hinweise of the day are due at `now`. */
export function noticesDue(
	user: { notificationHour: number; notificationWeekends: boolean; checkedOn: IsoDate | null },
	now: Date
): boolean {
	const today = dayOf(now);
	if (user.checkedOn !== null && user.checkedOn >= today) return false;
	if (Number(berlinHour.format(now)) < user.notificationHour) return false;
	const day = weekday(today);
	return user.notificationWeekends || (day !== 0 && day !== 6);
}

async function loadStates(db: Database, userId: string): Promise<Map<string, NotificationState>> {
	const rows = await db
		.select({
			entry: notificationStates.entry,
			date: notificationStates.date,
			stage: notificationStates.stage,
			snoozedUntil: notificationStates.snoozedUntil
		})
		.from(notificationStates)
		.where(eq(notificationStates.userId, userId));
	return new Map(rows.map(({ entry, ...state }) => [entry, state]));
}

/** Remembers the stage told for each notice; a snooze that led to it is used up. */
async function saveStates(
	db: Database,
	user: { id: string; accountId: string },
	notices: Notice[],
	now: Date
): Promise<void> {
	const rows = notices.map(({ entry, stage }) => ({
		accountId: user.accountId,
		userId: user.id,
		entry: entry.key,
		date: entry.date,
		stage,
		snoozedUntil: null,
		updatedAt: now
	}));
	await runBatch(
		db,
		chunk(rows, rowsPerStatement(notificationStates)).map((group) =>
			db
				.insert(notificationStates)
				.values(group)
				.onConflictDoUpdate({
					target: [notificationStates.userId, notificationStates.entry],
					set: {
						date: sql`excluded.date`,
						stage: sql`excluded.stage`,
						snoozedUntil: null,
						updatedAt: now
					}
				})
		)
	);
}

/**
 * Sends the day's Hinweise to every user whose hour has come and who has a channel that is not
 * paused. Hinweise that no channel could take are tried again with the next run; once none is
 * left the day is done, and an urgent-only channel simply skips the rest. Returns the number of
 * sends.
 */
export async function sendDueNotifications(db: Database, now: Date = new Date()): Promise<number> {
	const today = dayOf(now);
	const candidates = await db
		.selectDistinct({
			id: users.id,
			accountId: users.accountId,
			email: users.email,
			name: users.name,
			notificationHour: users.notificationHour,
			notificationWeekends: users.notificationWeekends,
			checkedOn: users.notificationsCheckedOn
		})
		.from(users)
		.innerJoin(notificationChannels, eq(notificationChannels.userId, users.id))
		.where(
			and(
				lt(notificationChannels.failures, MAX_FAILURES),
				or(isNull(users.notificationsCheckedOn), lt(users.notificationsCheckedOn, today))
			)
		);
	let sent = 0;
	for (const user of candidates) {
		if (!noticesDue(user, now)) continue;
		try {
			// Paused channels too: what only they would carry waits until they work again.
			const channels = await db
				.select()
				.from(notificationChannels)
				.where(eq(notificationChannels.userId, user.id));
			if (!channels.some((channel) => channel.failures < MAX_FAILURES)) continue;
			// Relative links; each channel's lead to the address it was added at.
			const [entries, states] = await Promise.all([
				calendarEntries(db, user.accountId, '', today),
				loadStates(db, user.id)
			]);
			const notices = dueNotices(entries, states, today);
			// A notice is handled once a channel took it, or when no channel wants it (nothing
			// urgent for an urgent-only channel). One whose working channels all failed is left for
			// the next run, which then sends only what is still open; the day is done when none
			// is. One that only a paused channel wants keeps waiting without holding up the day.
			const wanted = new Set<string>();
			const tried = new Set<string>();
			const taken = new Set<string>();
			for (const channel of channels) {
				const own = channel.urgentOnly ? notices.filter((n) => isUrgent(n.stage)) : notices;
				if (own.length === 0) continue;
				for (const notice of own) wanted.add(notice.entry.key);
				if (channel.failures >= MAX_FAILURES) continue;
				for (const notice of own) tried.add(notice.entry.key);
				const relinked = own.map((notice) => ({
					...notice,
					entry: { ...notice.entry, url: `${channel.origin}${notice.entry.url}` }
				}));
				if (await deliverAndRecord(db, channel, user, relinked, now)) {
					sent += 1;
					for (const notice of own) taken.add(notice.entry.key);
				}
			}
			const handled = notices.filter(({ entry }) => taken.has(entry.key) || !wanted.has(entry.key));
			if (handled.length > 0) await saveStates(db, user, handled, now);
			if ([...tried].some((key) => !taken.has(key))) continue;
			// States of entries that are gone (a task deleted or done, a deadline handled) are of
			// no use once their date lies long back; an entry still open keeps its state.
			const current = new Set(entries.map((entry) => entry.key));
			const stale = [...states]
				.filter(([key, state]) => !current.has(key) && state.date < addDays(today, -60))
				.map(([key]) => key);
			await runBatch(db, [
				db.update(users).set({ notificationsCheckedOn: today }).where(eq(users.id, user.id)),
				...chunkIds(stale).map((keys) =>
					db
						.delete(notificationStates)
						.where(
							and(eq(notificationStates.userId, user.id), inArray(notificationStates.entry, keys))
						)
				)
			]);
		} catch (error) {
			console.error(`[notifications] The Hinweise of user ${user.id} were not sent:`, error);
		}
	}
	return sent;
}

// The settings page.

export type NotificationSettings = {
	hour: number;
	weekends: boolean;
	/** Without their secrets, which never go to the page. */
	channels: (Omit<Channel, 'secret'> & { hasSecret: boolean })[];
	history: {
		id: string;
		channelId: string;
		summary: string;
		error: string | null;
		createdAt: Date;
	}[];
};

export async function getNotificationSettings(
	db: Database,
	userId: string
): Promise<NotificationSettings> {
	const [[user], channels, history] = await Promise.all([
		db
			.select({ hour: users.notificationHour, weekends: users.notificationWeekends })
			.from(users)
			.where(eq(users.id, userId)),
		db
			.select()
			.from(notificationChannels)
			.where(eq(notificationChannels.userId, userId))
			.orderBy(notificationChannels.createdAt),
		db
			.select({
				id: notificationDeliveries.id,
				channelId: notificationDeliveries.channelId,
				summary: notificationDeliveries.summary,
				error: notificationDeliveries.error,
				createdAt: notificationDeliveries.createdAt
			})
			.from(notificationDeliveries)
			.where(eq(notificationDeliveries.userId, userId))
			.orderBy(desc(notificationDeliveries.createdAt))
			.limit(20)
	]);
	return {
		hour: user?.hour ?? 7,
		weekends: user?.weekends ?? false,
		channels: channels.map(({ secret, ...channel }) => ({
			...channel,
			hasSecret: secret !== null
		})),
		history
	};
}

export async function setNotificationTiming(
	db: Database,
	userId: string,
	hour: number,
	weekends: boolean
): Promise<void> {
	await db
		.update(users)
		.set({ notificationHour: hour, notificationWeekends: weekends })
		.where(eq(users.id, userId));
}

export type ChannelInput = {
	kind: NotificationChannelKind;
	url?: string;
	token?: string;
	urgentOnly: boolean;
	details: boolean;
};

export type ChannelError = 'limit' | 'email-exists' | 'url';

/**
 * Checks the address of an ntfy topic or a webhook: https, or http as well where the instance is
 * self-hosted and may post into its own network (Home Assistant, n8n at home).
 */
export function validChannelUrl(
	kind: NotificationChannelKind,
	url: string,
	allowHttp: boolean
): boolean {
	if (url.length > 500 || !URL.canParse(url)) return false;
	const parsed = new URL(url);
	if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) return false;
	if (parsed.username || parsed.password) return false;
	return kind !== 'ntfy' || ntfyTarget(url) !== undefined;
}

/**
 * Adds a channel. A webhook gets a new signing secret, returned once, so the receiver can check
 * the requests; the other kinds return none.
 */
export async function addChannel(
	db: Database,
	context: AuditContext,
	input: ChannelInput,
	origin: string,
	allowHttp: boolean
): Promise<{ ok: true; id: string; secret?: string } | { ok: false; reason: ChannelError }> {
	const { accountId, userId } = context;
	if (!userId) throw new Error('A channel belongs to a user.');
	const existing = await db
		.select({ kind: notificationChannels.kind })
		.from(notificationChannels)
		.where(eq(notificationChannels.userId, userId));
	if (existing.length >= MAX_CHANNELS) return { ok: false, reason: 'limit' };
	if (input.kind === 'email' && existing.some((channel) => channel.kind === 'email')) {
		return { ok: false, reason: 'email-exists' };
	}
	const url = input.kind === 'email' ? null : (input.url ?? '').trim();
	if (url !== null && !validChannelUrl(input.kind, url, allowHttp)) {
		return { ok: false, reason: 'url' };
	}
	const secret =
		input.kind === 'webhook'
			? `whsec_${generateToken()}`
			: input.kind === 'ntfy' && input.token?.trim()
				? input.token.trim()
				: null;
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(notificationChannels).values({
			id,
			accountId,
			userId,
			kind: input.kind,
			url,
			secret,
			origin,
			urgentOnly: input.urgentOnly,
			details: input.kind === 'email' ? true : input.details
		}),
		auditEntry(
			db,
			context,
			'notification_channel',
			id,
			'create',
			`Hinweise per ${channelKindLabels[input.kind]} eingeschaltet`
		)
	]);
	return input.kind === 'webhook' && secret ? { ok: true, id, secret } : { ok: true, id };
}

export async function removeChannel(
	db: Database,
	context: AuditContext,
	channelId: string
): Promise<boolean> {
	const channel = await ownChannel(db, context, channelId);
	if (!channel) return false;
	await runBatch(db, [
		db.delete(notificationChannels).where(eq(notificationChannels.id, channel.id)),
		auditEntry(
			db,
			context,
			'notification_channel',
			channel.id,
			'delete',
			`Hinweise per ${channelKindLabels[channel.kind]} ausgeschaltet`
		)
	]);
	return true;
}

async function ownChannel(
	db: Database,
	context: AuditContext,
	channelId: string
): Promise<Channel | undefined> {
	if (!context.userId) return undefined;
	const [channel] = await db
		.select()
		.from(notificationChannels)
		.where(
			and(eq(notificationChannels.id, channelId), eq(notificationChannels.userId, context.userId))
		);
	return channel;
}

/** Sends a test to the channel; one that goes through also ends a pause. */
export async function testChannel(
	db: Database,
	context: AuditContext,
	channelId: string,
	recipient: Recipient,
	now: Date = new Date()
): Promise<{ ok: boolean; error?: string } | undefined> {
	const channel = await ownChannel(db, context, channelId);
	if (!channel) return undefined;
	const ok = await deliverAndRecord(db, channel, recipient, [], now, true);
	if (ok) return { ok };
	const [after] = await db
		.select({ lastError: notificationChannels.lastError })
		.from(notificationChannels)
		.where(eq(notificationChannels.id, channel.id));
	return { ok, error: after?.lastError ?? undefined };
}

// Snoozing, from the link in a Hinweis.

/** The entry behind a key, if the account still has it. */
export async function findEntry(
	db: Database,
	accountId: string,
	key: string,
	origin: string,
	today: IsoDate = dayOf(new Date())
): Promise<CalendarEntry | undefined> {
	if (!/^(task|deadline)-[-\w]{1,80}$/.test(key)) return undefined;
	const entries = await calendarEntries(db, accountId, origin, today);
	return entries.find((entry) => entry.key === key);
}

/** No Hinweis about the entry until `until`; then the stage it is in by then is told again. */
export async function snooze(
	db: Database,
	context: { accountId: string; userId: string },
	entry: CalendarEntry,
	until: IsoDate,
	now: Date = new Date()
): Promise<void> {
	await db
		.insert(notificationStates)
		.values({
			accountId: context.accountId,
			userId: context.userId,
			entry: entry.key,
			date: entry.date,
			stage: null,
			snoozedUntil: until,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: [notificationStates.userId, notificationStates.entry],
			set: { date: entry.date, stage: null, snoozedUntil: until, updatedAt: now }
		});
}

/** The day a snooze of the entry lasts until, if one is running. */
export async function snoozedUntil(
	db: Database,
	userId: string,
	entry: CalendarEntry,
	today: IsoDate
): Promise<IsoDate | undefined> {
	const [state] = await db
		.select({ until: notificationStates.snoozedUntil })
		.from(notificationStates)
		.where(
			and(
				eq(notificationStates.userId, userId),
				eq(notificationStates.entry, entry.key),
				eq(notificationStates.date, entry.date)
			)
		);
	return state?.until && state.until > today ? state.until : undefined;
}
