import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from './db';
import { outbox, tasks } from './db/schema';
import {
	digestDue,
	digestMail,
	getDeadlineMail,
	sendDueDeadlineMails,
	setDeadlineMail,
	weekStart
} from './deadline-mails';
import { testDatabase } from './testing';

vi.mock('$app/env/private', () => ({ MAIL_TRANSPORT: 'outbox', MAIL_API_KEY: '', MAIL_FROM: '' }));

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Monday, 2 November 2026, at the given time in UTC; Germany is an hour ahead in November. */
const monday = (time: string) => new Date(`2026-11-02T${time}Z`);

async function task(accountId: string, title: string, dueDate: string, done = false) {
	await db.insert(tasks).values({ accountId, title, dueDate, done });
}

describe('the week of a Fristenübersicht', () => {
	it('starts on Monday', () => {
		expect(weekStart('2026-11-02')).toBe('2026-11-02');
		expect(weekStart('2026-11-08')).toBe('2026-11-02');
		expect(weekStart('2026-11-04')).toBe('2026-11-02');
	});

	it('is due from 6 o’clock in Germany, once a week', () => {
		expect(digestDue(null, monday('04:59:00'))).toBe(false);
		expect(digestDue(null, monday('05:00:00'))).toBe(true);
		expect(digestDue('2026-10-26', monday('05:00:00'))).toBe(true);
		expect(digestDue('2026-11-02', monday('20:00:00'))).toBe(false);
		// Missed on Monday, it goes out later in the week.
		expect(digestDue('2026-10-26', new Date('2026-11-05T09:00:00Z'))).toBe(true);
	});
});

describe('digestMail', () => {
	const entry = (date: string, summary: string, description?: string) => ({
		uid: summary,
		date,
		summary,
		description,
		url: `https://app.example.org/aufgaben?bearbeiten=${summary}`
	});

	it('lists the overdue entries first, then the ones of the next two weeks', () => {
		const mail = digestMail(
			{ email: 'a@example.org', name: 'Katrin' },
			[
				entry('2026-10-30', 'Zählerstand ablesen (überfällig)', 'Müller · EG links'),
				entry('2026-11-10', 'Rauchmelder prüfen')
			],
			'https://app.example.org',
			'2026-11-02'
		);
		expect(mail.to).toBe('a@example.org');
		expect(mail.subject).toBe('Fristen: 1 überfällig, 1 bis 15.11.2026 | mietkartei');
		expect(mail.text).toContain(
			'Hallo Katrin,\n\nhier sind die Fristen und Aufgaben deiner Mietkartei, die überfällig sind oder bis zum 15.11.2026 anstehen.\n\n' +
				'Überfällig\n\n- 30.10.2026: Zählerstand ablesen (überfällig)\n  Müller · EG links\n' +
				'  https://app.example.org/aufgaben?bearbeiten=Zählerstand ablesen (überfällig)\n\n' +
				'Bis zum 15.11.2026\n\n- 10.11.2026: Rauchmelder prüfen\n'
		);
		expect(mail.text).toContain(
			'Abbestellen kannst du sie unter https://app.example.org/einstellungen/kalender.'
		);
	});

	it('says so when nothing is due', () => {
		const mail = digestMail(
			{ email: 'a@example.org', name: null },
			[],
			'https://x.de',
			'2026-11-02'
		);
		expect(mail.subject).toBe('Fristen: nichts in den nächsten zwei Wochen | mietkartei');
		expect(mail.text).toMatch(/^Hallo,\n\nbis zum 15\.11\.2026 stehen keine Fristen/);
	});
});

describe('sendDueDeadlineMails', () => {
	it('sends the week’s mail once to each user who turned it on, and only with something due', async () => {
		await setDeadlineMail(db, 'user-a', 'https://app.example.org');
		await setDeadlineMail(db, 'user-b', 'https://app.example.org');
		await task('a', 'Rauchmelder prüfen', '2026-11-10');
		await task('a', 'Heizung warten', '2026-10-20');
		// Later than two weeks, or done: not in the mail.
		await task('a', 'Dachrinne reinigen', '2026-11-16');
		await task('a', 'Fenster streichen', '2026-11-03', true);

		expect(await sendDueDeadlineMails(db, monday('04:00:00'))).toBe(0);
		expect(await sendDueDeadlineMails(db, monday('07:00:00'))).toBe(1);
		const [mail] = await db.select().from(outbox);
		expect(mail.to).toBe('a@example.org');
		expect(mail.text).toContain('- 20.10.2026: Heizung warten');
		expect(mail.text).toContain('- 10.11.2026: Rauchmelder prüfen');
		expect(mail.text).not.toContain('Dachrinne');
		expect(mail.text).not.toContain('Fenster');
		// Account b had nothing due; both count as done for the week.
		expect(await getDeadlineMail(db, 'user-b')).toEqual({
			origin: 'https://app.example.org',
			sentOn: '2026-11-02'
		});
		expect(await sendDueDeadlineMails(db, monday('08:00:00'))).toBe(0);
		expect(await sendDueDeadlineMails(db, new Date('2026-11-09T06:00:00Z'))).toBe(1);
		expect(await db.select().from(outbox)).toHaveLength(2);
	});

	it('sends nothing to a user who turned it off, and tries a failed mail again', async () => {
		await task('a', 'Rauchmelder prüfen', '2026-11-10');
		expect(await sendDueDeadlineMails(db, monday('07:00:00'))).toBe(0);

		await setDeadlineMail(db, 'user-a', 'https://app.example.org');
		vi.spyOn(console, 'error').mockImplementation(() => {});
		// The outbox refuses the mail as a provider would.
		const insert = vi.spyOn(db, 'insert').mockImplementationOnce(() => {
			throw new Error('provider down');
		});
		expect(await sendDueDeadlineMails(db, monday('07:00:00'))).toBe(0);
		expect(await getDeadlineMail(db, 'user-a')).toMatchObject({ sentOn: null });
		insert.mockRestore();
		expect(await sendDueDeadlineMails(db, monday('08:00:00'))).toBe(1);

		await setDeadlineMail(db, 'user-a', null);
		expect(await getDeadlineMail(db, 'user-a')).toEqual({ origin: null, sentOn: null });
	});
});
