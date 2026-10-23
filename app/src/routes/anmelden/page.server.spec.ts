import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { users } from '#lib/server/db/schema.ts';
import { outcome, PASSWORD, routeEvent, setPassword, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	await setPassword(db, 'user-a');
});

function signIn(form: Record<string, string>, cookies = new Map<string, string>()) {
	return outcome(() => actions.default(routeEvent(db, { user: null, form, cookies })));
}

describe('load', () => {
	it('sends signed-in users home and a new instance to the registration', async () => {
		expect(await outcome(() => load(routeEvent(db)))).toEqual({ redirect: '/' });
		expect(await outcome(() => load(routeEvent(db, { user: null })))).toEqual({ data: undefined });
		await db.delete(users);
		expect(await outcome(() => load(routeEvent(db, { user: null })))).toEqual({
			redirect: '/registrieren'
		});
	});
});

describe('sign in', () => {
	it('sets the session cookie and goes home', async () => {
		const cookies = new Map<string, string>();
		expect(await signIn({ email: 'A@example.org ', password: PASSWORD }, cookies)).toEqual({
			redirect: '/'
		});
		expect(cookies.get('session')).toMatch(/^[\w-]{43}$/);
	});

	it('refuses missing, overlong and wrong credentials without a cookie', async () => {
		const cookies = new Map<string, string>();
		expect(await signIn({ email: 'a@example.org' }, cookies)).toEqual({
			fail: 400,
			data: { email: 'a@example.org', invalid: true }
		});
		expect(await signIn({ email: 'a@example.org', password: 'x'.repeat(201) }, cookies)).toEqual({
			fail: 400,
			data: { email: '', invalid: true }
		});
		expect(await signIn({ email: 'a@example.org', password: 'falsch' }, cookies)).toEqual({
			fail: 400,
			data: { email: 'a@example.org', invalid: true }
		});
		expect(cookies.size).toBe(0);
	});

	it('locks the address after five wrong passwords, even for the right one', async () => {
		for (let attempt = 0; attempt < 5; attempt++) {
			await signIn({ email: 'a@example.org', password: 'falsch' });
		}
		expect(await signIn({ email: 'a@example.org', password: PASSWORD })).toEqual({
			fail: 429,
			data: { email: 'a@example.org', invalid: false, locked: true }
		});
	});
});
