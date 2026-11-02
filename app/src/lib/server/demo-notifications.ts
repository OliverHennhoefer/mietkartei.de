import { addDays, addMonths, type IsoDate } from '../dates';
import type { Database } from './db';
import { chunk, rowsPerStatement, runBatch } from './db/batch';
import { notificationChannels, notificationDeliveries } from './db/schema';

// The Benachrichtigungen of the public demo: the owner gets Hinweise by mail, the urgent ones as
// Mitteilungen on their iPhone, since the spring everything as Mitteilungen on their laptop too,
// and for the last year everything on a webhook to n8n, with a history of sends that reaches back
// over the years like the rest of the demo. The demo sends nothing; the addresses lead nowhere.

const ORIGIN = 'https://demo.mietkartei.de';

type Send = { date: IsoDate; summary: string; urgent: boolean };

/** One landlord's year of Hinweise, by month and day. */
const year: { monthDay: string; summary: string; urgent?: boolean }[] = [
	{ monthDay: '01-12', summary: '2 neu' },
	{ monthDay: '03-02', summary: '1 neu' },
	{ monthDay: '04-20', summary: '1 neu' },
	{ monthDay: '06-01', summary: '1 neu' },
	{ monthDay: '06-27', summary: '1 bald fällig', urgent: true },
	{ monthDay: '09-01', summary: '1 neu' },
	{ monthDay: '09-09', summary: '1 überfällig', urgent: true },
	{ monthDay: '10-06', summary: '2 neu' },
	{ monthDay: '10-29', summary: '1 bald fällig', urgent: true },
	{ monthDay: '11-19', summary: '1 neu' },
	{ monthDay: '12-28', summary: '1 bald fällig', urgent: true }
];

/** The sends from `from` until the day before `today`, oldest first. */
export function demoSends(from: IsoDate, today: IsoDate): Send[] {
	const sends: Send[] = [];
	for (let y = Number(from.slice(0, 4)); y <= Number(today.slice(0, 4)); y += 1) {
		for (const entry of year) {
			const date = `${y}-${entry.monthDay}`;
			if (date < from || date >= today) continue;
			sends.push({ date, summary: entry.summary, urgent: entry.urgent ?? false });
		}
	}
	return sends;
}

const berlinHour = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Berlin',
	hour: 'numeric',
	hourCycle: 'h23'
});

/** Two minutes past 7 in Germany on the day, just after the job's run. */
function at(date: IsoDate): Date {
	const summer = new Date(`${date}T05:02:00Z`);
	return berlinHour.format(summer) === '7' ? summer : new Date(`${date}T06:02:00Z`);
}

export async function createDemoNotifications(
	db: Database,
	context: { accountId: string; userId: string },
	today: IsoDate
): Promise<void> {
	const { accountId, userId } = context;
	const since = addMonths(today, -40);
	const webhookSince = addMonths(today, -12);
	const laptopSince = addMonths(today, -7);
	const channels = [
		{ id: crypto.randomUUID(), kind: 'email' as const, since, urgentOnly: false },
		{
			id: crypto.randomUUID(),
			kind: 'push' as const,
			since,
			urgentOnly: true,
			label: 'iPhone',
			url: 'https://web.push.apple.com/demo-iphone'
		},
		{
			id: crypto.randomUUID(),
			kind: 'push' as const,
			since: laptopSince,
			urgentOnly: false,
			label: 'Windows (Edge)',
			url: 'https://wns2-par02p.notify.windows.com/w/?token=demo'
		},
		{
			id: crypto.randomUUID(),
			kind: 'webhook' as const,
			since: webhookSince,
			urgentOnly: false,
			url: 'https://n8n.example.de/webhook/mietkartei'
		}
	];
	const deliveries: (typeof notificationDeliveries.$inferInsert)[] = [];
	const lastSent = new Map<string, Date>();
	for (const channel of channels) {
		const sends = demoSends(channel.since, today).filter(
			(send) => send.urgent || !channel.urgentOnly
		);
		sends.forEach((send, index) => {
			const createdAt = at(send.date);
			const row = { accountId, userId, channelId: channel.id, summary: send.summary };
			// Once Apple's push service was busy; an hour later the Hinweis came through.
			if (channel.label === 'iPhone' && index === 3) {
				deliveries.push({ ...row, error: 'Antwort 503', createdAt });
				createdAt.setTime(createdAt.getTime() + 60 * 60 * 1000);
			}
			deliveries.push({ ...row, createdAt });
			lastSent.set(channel.id, createdAt);
		});
	}
	await runBatch(db, [
		db.insert(notificationChannels).values(
			channels.map((channel) => ({
				id: channel.id,
				accountId,
				userId,
				kind: channel.kind,
				url: channel.url ?? null,
				secret: channel.kind === 'webhook' ? 'whsec_demo' : null,
				label: channel.label ?? null,
				origin: ORIGIN,
				urgentOnly: channel.urgentOnly,
				details: channel.kind !== 'push',
				lastSentAt: lastSent.get(channel.id) ?? null,
				createdAt: at(addDays(channel.since, -1))
			}))
		),
		...chunk(deliveries, rowsPerStatement(notificationDeliveries)).map((group) =>
			db.insert(notificationDeliveries).values(group)
		)
	]);
}
