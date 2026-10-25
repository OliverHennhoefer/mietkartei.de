import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { registrationRequests, users } from '#lib/server/db/schema.ts';
import { requestRegistration } from '#lib/server/registration-requests.ts';
import { outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const env = vi.hoisted(() => ({
	REGISTRATION_EMAILS: 'neu@example.org',
	STRIPE_SECRET_KEY: '',
	STRIPE_PRICE_ID: '',
	TRIAL_FINGERPRINT_KEY: ''
}));
vi.mock('$app/env/private', () => env);

let db: Database;
let token: string;

beforeEach(async () => {
	db = await testDatabase();
	env.REGISTRATION_EMAILS = 'neu@example.org';
	token = (await requestRegistration(db, 'neu@example.org'))!.token;
});

const password = { password: 'lang-genug-1234', passwordConfirm: 'lang-genug-1234' };

function complete(form: Record<string, string>, cookies = new Map<string, string>()) {
	return outcome(() =>
		actions.default(routeEvent(db, { user: null, params: { token }, form, cookies }))
	);
}

describe('load', () => {
	it('shows the address of a valid link and 404 for any other', async () => {
		expect(await outcome(() => load(routeEvent(db, { user: null, params: { token } })))).toEqual({
			data: { email: 'neu@example.org' }
		});
		expect(
			await outcome(() => load(routeEvent(db, { user: null, params: { token: 'unknown' } })))
		).toMatchObject({ error: 404 });
		expect(await outcome(() => load(routeEvent(db, { params: { token } })))).toEqual({
			redirect: '/'
		});
	});
});

describe('complete', () => {
	it('creates the account in a new account, signs in and uses up the link', async () => {
		const cookies = new Map<string, string>();
		expect(await complete(password, cookies)).toEqual({ redirect: '/' });
		expect(cookies.get('session')).toBeTruthy();
		const created = (await db.select().from(users)).find((u) => u.email === 'neu@example.org');
		expect(created?.accountId).not.toMatch(/^[ab]$/);
		expect(await db.select().from(registrationRequests)).toEqual([]);
		expect(await complete(password)).toMatchObject({ error: 404 });
	});

	it('refuses a password that does not match', async () => {
		expect(
			await complete({ password: 'lang-genug-1234', passwordConfirm: 'anders' })
		).toMatchObject({
			fail: 400
		});
	});

	it('refuses once the address has left REGISTRATION_EMAILS', async () => {
		env.REGISTRATION_EMAILS = 'andere@example.org';
		expect(await complete(password)).toEqual({ fail: 403, data: { closed: true } });
	});

	it('refuses an address that got an account in the meantime', async () => {
		await db
			.insert(users)
			.values({ accountId: 'b', email: 'neu@example.org', passwordHash: 'x', role: 'manager' });
		expect(await complete(password)).toEqual({ fail: 400, data: { taken: true } });
	});
});
