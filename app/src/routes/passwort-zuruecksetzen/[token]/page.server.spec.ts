import { beforeEach, describe, expect, it } from 'vitest';
import { createSession, signIn } from '#lib/server/auth.ts';
import type { Database } from '#lib/server/db/index.ts';
import { sessions } from '#lib/server/db/schema.ts';
import { requestPasswordReset } from '#lib/server/password-resets.ts';
import { outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

let db: Database;
let token: string;

beforeEach(async () => {
	db = await testDatabase();
	token = (await requestPasswordReset(db, 'a@example.org'))!.token;
});

const password = { password: 'neu-und-lang-1', passwordConfirm: 'neu-und-lang-1' };

function reset(form: Record<string, string>, cookies = new Map<string, string>()) {
	return outcome(() =>
		actions.default(routeEvent(db, { user: null, params: { token }, form, cookies }))
	);
}

describe('passwort-zuruecksetzen', () => {
	it('opens for a valid link and answers 404 for any other', async () => {
		expect(await outcome(() => load(routeEvent(db, { user: null, params: { token } })))).toEqual({
			data: {}
		});
		expect(
			await outcome(() => load(routeEvent(db, { user: null, params: { token: 'x' } })))
		).toMatchObject({ error: 404 });
	});

	it('sets the password, ends the other sessions and signs this browser in', async () => {
		const old = await createSession(db, 'user-a');
		const cookies = new Map<string, string>();
		expect(await reset(password, cookies)).toEqual({ redirect: '/' });
		expect(await signIn(db, 'a@example.org', password.password)).toMatchObject({ ok: true });
		const left = await db.select().from(sessions);
		expect(left).toHaveLength(1);
		expect(cookies.get('session')).not.toBe(old.token);
		// The link is used up.
		expect(await reset(password)).toMatchObject({ error: 404 });
	});

	it('refuses passwords that do not match and keeps the link', async () => {
		expect(await reset({ password: 'neu-und-lang-1', passwordConfirm: 'x' })).toMatchObject({
			fail: 400
		});
		expect(await reset(password)).toEqual({ redirect: '/' });
	});
});
