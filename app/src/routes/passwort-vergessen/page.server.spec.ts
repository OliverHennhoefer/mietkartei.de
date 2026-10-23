import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { outbox, passwordResets } from '#lib/server/db/schema.ts';
import { outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const env = vi.hoisted(() => ({ ORIGIN: '', MAIL_TRANSPORT: 'outbox' }));
vi.mock('$app/env/private', () => env);

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	env.ORIGIN = '';
});

function request(email: string, url = 'http://localhost/passwort-vergessen') {
	return outcome(() => actions.default(routeEvent(db, { user: null, url, form: { email } })));
}

describe('passwort-vergessen', () => {
	it('sends signed-in users to their profile', async () => {
		expect(await outcome(() => load(routeEvent(db)))).toEqual({
			redirect: '/einstellungen/profil'
		});
	});

	it('mails a reset link and answers the same for unknown addresses', async () => {
		expect(await request('a@example.org')).toEqual({ data: { sent: true } });
		expect(await request('niemand@example.org')).toEqual({ data: { sent: true } });
		const mails = await db.select().from(outbox);
		expect(mails).toHaveLength(1);
		expect(mails[0]).toMatchObject({ to: 'a@example.org' });
		expect(mails[0].text).toMatch(/http:\/\/localhost\/passwort-zuruecksetzen\/[\w-]{43}/);
	});

	it('refuses an invalid address', async () => {
		expect(await request('kaputt')).toMatchObject({
			fail: 400,
			data: { values: { email: 'kaputt' } }
		});
	});

	it('refuses a link to a foreign host before looking up the address', async () => {
		expect(await request('a@example.org', 'http://evil.example/passwort-vergessen')).toMatchObject({
			fail: 503
		});
		expect(await db.select().from(passwordResets)).toEqual([]);
	});
});
