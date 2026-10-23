import { describe, expect, it } from 'vitest';
import { createSession, validateSession } from '#lib/server/auth.ts';
import { outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

describe('abmelden', () => {
	it('only signs out by posting the form', async () => {
		const db = await testDatabase();
		expect(await outcome(() => load(routeEvent(db)))).toEqual({ redirect: '/' });
	});

	it('ends the session and deletes the cookie', async () => {
		const db = await testDatabase();
		const { token } = await createSession(db, 'user-a');
		const cookies = new Map([['session', token]]);
		expect(await outcome(() => actions.default(routeEvent(db, { cookies, form: {} })))).toEqual({
			redirect: '/anmelden'
		});
		expect(cookies.size).toBe(0);
		expect(await validateSession(db, token)).toBeUndefined();
		// Without a cookie there is nothing to end.
		expect(await outcome(() => actions.default(routeEvent(db, { form: {} })))).toEqual({
			redirect: '/anmelden'
		});
	});
});
