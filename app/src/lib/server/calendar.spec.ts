import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	accountOfToken,
	buildCalendar,
	calendarEntries,
	createCalendarFeed,
	deleteCalendarFeed,
	getCalendarFeed
} from './calendar';
import type { Database } from './db';
import { auditLog, calendarFeeds } from './db/schema';
import { createLease } from './leases';
import { createTask, setDone } from './tasks';
import { contextA, contextB, leaseInput, seedTenant, seedUnit, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

describe('calendar links', () => {
	it('creates a link per user, replaces it and revokes it', async () => {
		expect(await getCalendarFeed(db, 'user-a')).toBeNull();
		const first = await createCalendarFeed(db, contextA);
		expect(await accountOfToken(db, first)).toBe('a');
		expect(await getCalendarFeed(db, 'user-a')).toMatchObject({ createdAt: expect.any(Date) });

		const second = await createCalendarFeed(db, contextA);
		expect(await accountOfToken(db, first)).toBeUndefined();
		expect(await accountOfToken(db, second)).toBe('a');
		// Only the hash is stored.
		const rows = await db.select().from(calendarFeeds);
		expect(rows).toHaveLength(1);
		expect(rows[0].tokenHash).not.toContain(second);

		expect(await deleteCalendarFeed(db, contextA)).toBe(true);
		expect(await accountOfToken(db, second)).toBeUndefined();
		expect(await deleteCalendarFeed(db, contextA)).toBe(false);

		const audit = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(audit.map((row) => row.summary)).toEqual([
			'Kalender-Link erstellt',
			'Kalender-Link erstellt',
			'Kalender-Link widerrufen'
		]);
	});

	it('refuses malformed tokens without a lookup', async () => {
		expect(await accountOfToken(db, '')).toBeUndefined();
		expect(await accountOfToken(db, 'x'.repeat(200))).toBeUndefined();
		expect(await accountOfToken(db, '../../etc/passwd-aaaaaaaaaaaa')).toBeUndefined();
	});
});

describe('calendarEntries', () => {
	it('holds the deadlines and open dated tasks of the account only', async () => {
		const { unitId } = await seedUnit(db, 'a', { propertyName: 'Haus' });
		const tenantId = await seedTenant(db, 'a', { firstName: 'Erika', lastName: 'Muster' });
		await createLease(
			db,
			contextA,
			leaseInput(unitId, {
				tenantIds: [tenantId],
				startDate: '2025-01-01',
				endDate: '2026-12-31',
				securityDeposit: 0
			})
		);
		const dated = await createTask(db, contextA, {
			title: 'Heizung warten',
			category: 'maintenance',
			dueDate: '2026-11-15',
			repeatMonths: null,
			propertyId: null,
			leaseId: null,
			note: 'Firma Wärme'
		});
		const done = await createTask(db, contextA, {
			title: 'Erledigt',
			category: 'other',
			dueDate: '2026-11-01',
			repeatMonths: null,
			propertyId: null,
			leaseId: null,
			note: null
		});
		await createTask(db, contextA, {
			title: 'Ohne Datum',
			category: 'other',
			dueDate: null,
			repeatMonths: null,
			propertyId: null,
			leaseId: null,
			note: null
		});
		await createTask(db, contextB, {
			title: 'Fremd',
			category: 'other',
			dueDate: '2026-11-01',
			repeatMonths: null,
			propertyId: null,
			leaseId: null,
			note: null
		});
		if (!dated.ok || !done.ok) throw new Error('task');
		await setDone(db, contextA, done.id, true);

		const entries = await calendarEntries(db, 'a', 'https://app.example', '2026-10-20');
		const lease = entries.find((entry) => entry.summary === 'Vertragsende');
		expect(lease).toMatchObject({
			date: '2026-12-31',
			description: expect.stringContaining('Erika Muster'),
			url: expect.stringMatching(/^https:\/\/app\.example\/vertraege\//),
			uid: expect.stringMatching(/^deadline-[0-9a-f]{24}@mietkartei\.de$/)
		});
		expect(entries.filter((entry) => entry.uid.startsWith('task-'))).toEqual([
			{
				uid: `task-${dated.id}@mietkartei.de`,
				date: '2026-11-15',
				summary: 'Heizung warten',
				description: 'Firma Wärme',
				url: `https://app.example/aufgaben?bearbeiten=${dated.id}`
			}
		]);
		// The same data gives the same UIDs, so calendar apps update instead of duplicating.
		const again = await calendarEntries(db, 'a', 'https://app.example', '2026-10-20');
		expect(again.map((entry) => entry.uid)).toEqual(entries.map((entry) => entry.uid));
		expect(new Set(entries.map((entry) => entry.uid)).size).toBe(entries.length);
	});
});

describe('buildCalendar', () => {
	it('writes all-day events with a reminder, escaped and folded', () => {
		const text = buildCalendar(
			[
				{
					uid: 'task-1@mietkartei.de',
					date: '2026-12-31',
					summary: 'Kaution abrechnen; Haus, EG',
					description: `Zeile 1\nZeile 2 ${'ä'.repeat(60)}`,
					url: 'https://app.example/aufgaben/1'
				}
			],
			new Date('2026-10-23T12:34:56.789Z')
		);
		expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
		expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
		expect(text).toContain('DTSTAMP:20261023T123456Z\r\n');
		expect(text).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n');
		expect(text).toContain('SUMMARY:Kaution abrechnen\\; Haus\\, EG\r\n');
		expect(text).toContain('TRIGGER:-P7D');
		const encoder = new TextEncoder();
		for (const line of text.split('\r\n'))
			expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
		// Unfolded, the description is whole again.
		expect(text.replace(/\r\n /g, '')).toContain(
			`DESCRIPTION:Zeile 1\\nZeile 2 ${'ä'.repeat(60)}\r\n`
		);
	});
});
