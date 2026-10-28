import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { getDeadlineMail } from '#lib/server/deadline-mails.ts';
import { outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { GET } from '../../api/calendar/[token].ics/+server';
import { actions, load } from './+page.server';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, options)));
}

describe('einstellungen/kalender', () => {
	it('creates a link that serves the calendar without a session, and revokes it', async () => {
		expect(await run(load)).toMatchObject({ data: { feed: null } });
		const created = (await run(actions.create)) as { data: { link: string } };
		const link = new URL(created.data.link);
		expect(link.pathname).toMatch(/^\/api\/calendar\/[\w-]+\.ics$/);
		const token = link.pathname.slice('/api/calendar/'.length, -'.ics'.length);
		expect(await run(load)).toMatchObject({ data: { feed: { createdAt: expect.any(Date) } } });

		const response = (await GET(routeEvent(db, { user: null, params: { token } }))) as Response;
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
		expect(await response.text()).toContain('X-WR-CALNAME:mietkartei Fristen');

		expect(await run(actions.delete)).toEqual({ data: { deleted: true } });
		expect(await run(actions.delete)).toMatchObject({ fail: 404 });
		expect(
			await outcome(() => GET(routeEvent(db, { user: null, params: { token } })))
		).toMatchObject({ error: 404 });
	});

	it('turns the weekly Fristenübersicht on with the address of the app, and off again', async () => {
		expect(await run(load)).toMatchObject({
			data: { deadlineMail: { on: false, sentOn: null, email: 'a@example.org' }, demo: false }
		});
		const url = 'https://mietkartei.example.de/einstellungen/kalender';
		expect(await run(actions.mail, { url, form: { on: 'true' } })).toEqual({
			data: { mailSaved: true }
		});
		expect(await getDeadlineMail(db, 'user-a')).toEqual({
			origin: 'https://mietkartei.example.de',
			sentOn: null
		});
		expect(await run(load)).toMatchObject({ data: { deadlineMail: { on: true } } });
		expect(await run(actions.mail, { url, form: { on: 'false' } })).toEqual({
			data: { mailSaved: false }
		});
		expect(await getDeadlineMail(db, 'user-a')).toEqual({ origin: null, sentOn: null });
	});
});
