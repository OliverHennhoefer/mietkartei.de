import { and, eq, isNotNull } from 'drizzle-orm';
import { addDays, addMonths, today as todayInBerlin, type IsoDate } from '../dates';
import { auditEntry, type AuditContext } from './audit';
import { generateToken, hashToken } from './auth';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { calendarFeeds, tasks } from './db/schema';
import { listDeadlines } from './deadlines';

// Fristenkalender: a secret link per user that a calendar app subscribes to (iCalendar, RFC 5545).
// It holds the account's deadlines of the next two years, the overdue ones included, and the
// open tasks with a due date. Only the token's hash is stored, so the link is shown once; a new
// link replaces the old one.

/** How far ahead the feed reaches. */
const FEED_MONTHS = 24;

/** Days before an entry its reminder goes off, for the calendar apps that honour it. */
const REMINDER_DAYS = 7;

export const calendarPath = (token: string) => `/api/calendar/${token}.ics`;

/** When the user's current link was created, or null without one. */
export async function getCalendarFeed(
	db: Database,
	userId: string
): Promise<{ createdAt: Date } | null> {
	const [feed] = await db
		.select({ createdAt: calendarFeeds.createdAt })
		.from(calendarFeeds)
		.where(eq(calendarFeeds.userId, userId));
	return feed ?? null;
}

/** A new link for the user, replacing their old one. Returns the token, which is shown once. */
export async function createCalendarFeed(db: Database, context: AuditContext): Promise<string> {
	const { accountId, userId } = context;
	if (!userId) throw new Error('A calendar link belongs to a user.');
	const token = generateToken();
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.delete(calendarFeeds).where(eq(calendarFeeds.userId, userId)),
		db.insert(calendarFeeds).values({ id, accountId, userId, tokenHash: await hashToken(token) }),
		auditEntry(db, context, 'calendar_feed', id, 'create', 'Kalender-Link erstellt')
	]);
	return token;
}

/** Revokes the user's link. False when there was none. */
export async function deleteCalendarFeed(db: Database, context: AuditContext): Promise<boolean> {
	const { userId } = context;
	if (!userId) return false;
	const [feed] = await db
		.select({ id: calendarFeeds.id })
		.from(calendarFeeds)
		.where(eq(calendarFeeds.userId, userId));
	if (!feed) return false;
	await runBatch(db, [
		db.delete(calendarFeeds).where(eq(calendarFeeds.id, feed.id)),
		auditEntry(db, context, 'calendar_feed', feed.id, 'delete', 'Kalender-Link widerrufen')
	]);
	return true;
}

/** The account a link token belongs to, or undefined for an unknown or revoked one. */
export async function accountOfToken(db: Database, token: string): Promise<string | undefined> {
	if (!/^[\w-]{20,100}$/.test(token)) return undefined;
	const [feed] = await db
		.select({ accountId: calendarFeeds.accountId })
		.from(calendarFeeds)
		.where(eq(calendarFeeds.tokenHash, await hashToken(token)));
	return feed?.accountId;
}

export type CalendarEntry = {
	uid: string;
	date: IsoDate;
	summary: string;
	description?: string;
	/** Absolute link to the page where the matter is handled. */
	url: string;
};

/** The entries of the account's feed: deadlines first, then the open tasks with a due date. */
export async function calendarEntries(
	db: Database,
	accountId: string,
	origin: string,
	today: IsoDate = todayInBerlin()
): Promise<CalendarEntry[]> {
	const [deadlines, openTasks] = await Promise.all([
		listDeadlines(db, accountId, { to: addMonths(today, FEED_MONTHS), today }),
		db
			.select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, note: tasks.note })
			.from(tasks)
			.where(and(eq(tasks.accountId, accountId), eq(tasks.done, false), isNotNull(tasks.dueDate)))
	]);
	const entries: CalendarEntry[] = [];
	const seen = new Set<string>();
	for (const deadline of deadlines) {
		// Stable across requests, so a calendar app updates an entry instead of adding it again;
		// a deadline that moves (the next notice deadline of a policy) keeps its entry.
		const key = [
			deadline.kind,
			deadline.leaseId,
			deadline.propertyId,
			deadline.href,
			deadline.title
		];
		const base = `deadline-${(await hashToken(key.join('|'))).slice(0, 24)}`;
		let uid = base;
		for (let index = 2; seen.has(uid); index += 1) uid = `${base}-${index}`;
		seen.add(uid);
		entries.push({
			uid: `${uid}@mietkartei.de`,
			date: deadline.date,
			summary: deadline.overdue ? `${deadline.title} (überfällig)` : deadline.title,
			description: deadline.detail,
			url: `${origin}${deadline.href}`
		});
	}
	for (const task of openTasks) {
		if (!task.dueDate) continue;
		entries.push({
			uid: `task-${task.id}@mietkartei.de`,
			date: task.dueDate,
			summary: task.title,
			description: task.note ?? undefined,
			url: `${origin}/aufgaben/${task.id}`
		});
	}
	return entries;
}

/** Escapes a TEXT value (RFC 5545, 3.3.11). */
function escapeText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r?\n/g, '\\n');
}

/** Folds a content line to at most 75 octets per line (RFC 5545, 3.1), not splitting a character. */
function fold(line: string): string {
	const encoder = new TextEncoder();
	const parts: string[] = [];
	let current = '';
	let size = 0;
	for (const char of line) {
		const bytes = encoder.encode(char).length;
		// Continuation lines start with a space, which counts towards their 75 octets.
		if (size + bytes > (parts.length === 0 ? 75 : 74)) {
			parts.push(current);
			current = '';
			size = 0;
		}
		current += char;
		size += bytes;
	}
	parts.push(current);
	return parts.join('\r\n ');
}

const compact = (date: IsoDate) => date.replace(/-/g, '');

function stamp(now: Date): string {
	return now
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
}

/** The feed as an iCalendar document: one all-day event per entry, with a reminder. */
export function buildCalendar(entries: CalendarEntry[], now: Date = new Date()): string {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//mietkartei//Fristen//DE',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'X-WR-CALNAME:mietkartei Fristen',
		'X-WR-TIMEZONE:Europe/Berlin',
		'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
		'X-PUBLISHED-TTL:PT6H'
	];
	for (const entry of entries) {
		lines.push(
			'BEGIN:VEVENT',
			`UID:${entry.uid}`,
			`DTSTAMP:${stamp(now)}`,
			`DTSTART;VALUE=DATE:${compact(entry.date)}`,
			`DTEND;VALUE=DATE:${compact(addDays(entry.date, 1))}`,
			`SUMMARY:${escapeText(entry.summary)}`,
			...(entry.description ? [`DESCRIPTION:${escapeText(entry.description)}`] : []),
			`URL:${entry.url}`,
			'TRANSP:TRANSPARENT',
			'BEGIN:VALARM',
			'ACTION:DISPLAY',
			`DESCRIPTION:${escapeText(entry.summary)}`,
			`TRIGGER:-P${REMINDER_DAYS}D`,
			'END:VALARM',
			'END:VEVENT'
		);
	}
	lines.push('END:VCALENDAR');
	return lines.map(fold).join('\r\n') + '\r\n';
}
