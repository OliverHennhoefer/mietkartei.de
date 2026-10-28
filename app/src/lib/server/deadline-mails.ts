import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { addDays, dayOf, formatDate, weekday, type IsoDate } from '../dates';
import { calendarEntries, type CalendarEntry } from './calendar';
import type { Database } from './db';
import { users } from './db/schema';
import { sendMail, type Mail } from './mail';

// Fristenübersicht per E-Mail: once a week, on Monday from 6 o'clock, every user who turned it on
// gets the account's deadlines and open tasks that are overdue or due in the next two weeks, the
// same entries as the calendar subscription. A week with nothing in it sends nothing. The job is
// started by server.js (node) or the cron trigger of worker.js (cloudflare), see jobs.ts.

/** How far ahead a Fristenübersicht reaches, the day of the mail included. */
export const DIGEST_DAYS = 14;

/** The hour in Germany from which the week's mail goes out. */
const SEND_FROM_HOUR = 6;

const berlinHour = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Berlin',
	hour: 'numeric',
	hourCycle: 'h23'
});

/** The Monday of the week of `date`. */
export function weekStart(date: IsoDate): IsoDate {
	return addDays(date, -((weekday(date) + 6) % 7));
}

/** Whether the user's Fristenübersicht of the week is due at `now`. */
export function digestDue(sentOn: IsoDate | null, now: Date): boolean {
	if (Number(berlinHour.format(now)) < SEND_FROM_HOUR) return false;
	return sentOn === null || sentOn < weekStart(dayOf(now));
}

type Recipient = { email: string; name: string | null };

/** The mail of a Fristenübersicht; `entries` are the ones due until the end of its two weeks. */
export function digestMail(
	recipient: Recipient,
	entries: CalendarEntry[],
	origin: string,
	today: IsoDate
): Mail {
	const until = addDays(today, DIGEST_DAYS - 1);
	const overdue = entries.filter((entry) => entry.date < today);
	const upcoming = entries.filter((entry) => entry.date >= today);
	const line = (entry: CalendarEntry) =>
		[
			`- ${formatDate(entry.date)}: ${entry.summary}`,
			...(entry.description ? [`  ${entry.description}`] : []),
			`  ${entry.url}`
		].join('\n');
	const section = (title: string, rows: CalendarEntry[]) =>
		rows.length > 0 ? [`${title}\n\n${rows.map(line).join('\n\n')}`] : [];
	const counts = [
		...(overdue.length > 0 ? [`${overdue.length} überfällig`] : []),
		...(upcoming.length > 0 ? [`${upcoming.length} bis ${formatDate(until)}`] : [])
	];
	const paragraphs = [
		recipient.name ? `Hallo ${recipient.name},` : 'Hallo,',
		entries.length > 0
			? `hier sind die Fristen und Aufgaben deiner Mietkartei, die überfällig sind oder bis zum ${formatDate(until)} anstehen.`
			: `bis zum ${formatDate(until)} stehen keine Fristen oder Aufgaben an, und nichts ist überfällig.`,
		...section('Überfällig', overdue),
		...section(`Bis zum ${formatDate(until)}`, upcoming),
		`Alle Fristen und Aufgaben: ${origin}/aufgaben`,
		`Die Übersicht kommt jeden Montag. Abbestellen kannst du sie unter ${origin}/einstellungen/kalender.`
	];
	return {
		to: recipient.email,
		subject:
			counts.length > 0
				? `Fristen: ${counts.join(', ')} | mietkartei`
				: 'Fristen: nichts in den nächsten zwei Wochen | mietkartei',
		text: `${paragraphs.join('\n\n')}\n`
	};
}

/** The entries of the account for a Fristenübersicht of `today`. */
async function digestEntries(
	db: Database,
	accountId: string,
	origin: string,
	today: IsoDate
): Promise<CalendarEntry[]> {
	const until = addDays(today, DIGEST_DAYS - 1);
	const entries = await calendarEntries(db, accountId, origin, today);
	return entries
		.filter((entry) => entry.date <= until)
		.sort((a, b) => a.date.localeCompare(b.date));
}

export type DeadlineMailSetting = { origin: string | null; sentOn: IsoDate | null };

export async function getDeadlineMail(db: Database, userId: string): Promise<DeadlineMailSetting> {
	const [user] = await db
		.select({ origin: users.deadlineMailOrigin, sentOn: users.deadlineMailSentOn })
		.from(users)
		.where(eq(users.id, userId));
	return user ?? { origin: null, sentOn: null };
}

/**
 * Turns the user's Fristenübersicht on with the address its links lead to, or off with null.
 * Turned on during a week, the first one goes out at once with the next run of the job.
 */
export async function setDeadlineMail(
	db: Database,
	userId: string,
	origin: string | null
): Promise<void> {
	await db
		.update(users)
		.set({ deadlineMailOrigin: origin, deadlineMailSentOn: null })
		.where(eq(users.id, userId));
}

/**
 * Sends the Fristenübersicht of the week to every user who turned it on and has not had it yet.
 * A user whose mail fails is tried again with the next run. Returns the number of mails sent.
 */
export async function sendDueDeadlineMails(db: Database, now: Date = new Date()): Promise<number> {
	const today = dayOf(now);
	const recipients = await db
		.select({
			id: users.id,
			accountId: users.accountId,
			email: users.email,
			name: users.name,
			origin: users.deadlineMailOrigin,
			sentOn: users.deadlineMailSentOn
		})
		.from(users)
		.where(
			and(
				isNotNull(users.deadlineMailOrigin),
				or(isNull(users.deadlineMailSentOn), lt(users.deadlineMailSentOn, weekStart(today)))
			)
		);
	let sent = 0;
	for (const recipient of recipients) {
		if (!recipient.origin || !digestDue(recipient.sentOn, now)) continue;
		try {
			const entries = await digestEntries(db, recipient.accountId, recipient.origin, today);
			if (entries.length > 0) {
				await sendMail(db, digestMail(recipient, entries, recipient.origin, today));
				sent += 1;
			}
			await db.update(users).set({ deadlineMailSentOn: today }).where(eq(users.id, recipient.id));
		} catch (error) {
			console.error(`[mail] The Fristenübersicht of user ${recipient.id} was not sent:`, error);
		}
	}
	return sent;
}
