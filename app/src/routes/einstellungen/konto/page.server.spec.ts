import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { accounts, properties, users } from '#lib/server/db/schema.ts';
import {
	managerA,
	outcome,
	PASSWORD,
	routeEvent,
	seedUnit,
	setPassword,
	testDatabase
} from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const env = vi.hoisted(() => ({
	STRIPE_SECRET_KEY: '',
	STRIPE_PRICE_ID: '',
	STRIPE_API_BASE: 'http://stripe.test',
	BILLING_REQUIRED: false
}));
vi.mock('$app/env/private', () => env);

const storage = vi.hoisted(() => ({
	deletePrefix: vi.fn<(prefix: string) => Promise<void>>(async () => {})
}));
vi.mock('#lib/server/storage/index.ts', async (original) => ({
	...(await original<typeof import('#lib/server/storage/index.ts')>()),
	getStorage: async () => storage
}));

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	await setPassword(db, 'user-a');
	Object.assign(env, { STRIPE_SECRET_KEY: '', STRIPE_PRICE_ID: '' });
	storage.deletePrefix.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function accountExists(id: string) {
	return (await db.select().from(accounts).where(eq(accounts.id, id))).length > 0;
}

describe('load', () => {
	it('offers demo data to the owner of an empty account only', async () => {
		expect(await outcome(() => load(routeEvent(db)))).toEqual({
			data: { isOwner: true, canLoadDemo: true, subscriptionRuns: false }
		});
		expect(await outcome(() => load(routeEvent(db, { user: managerA })))).toEqual({
			data: { isOwner: false, canLoadDemo: false, subscriptionRuns: false }
		});
		await seedUnit(db, 'a');
		expect(await outcome(() => load(routeEvent(db)))).toMatchObject({
			data: { canLoadDemo: false }
		});
	});
});

describe('demo', () => {
	it('fills an empty account once and is for owners only', async () => {
		expect(await outcome(() => actions.demo(routeEvent(db, { form: {} })))).toEqual({
			redirect: '/'
		});
		expect((await db.select().from(properties)).length).toBeGreaterThan(0);
		expect(await outcome(() => actions.demo(routeEvent(db, { form: {} })))).toMatchObject({
			fail: 400
		});
		expect(
			await outcome(() => actions.demo(routeEvent(db, { user: managerA, form: {} })))
		).toMatchObject({ error: 403 });
	});
});

describe('delete', () => {
	function remove(password: string, cookies = new Map<string, string>()) {
		return outcome(() => actions.delete(routeEvent(db, { form: { password }, cookies })));
	}

	it('deletes the account with its files after the password and signs out', async () => {
		const cookies = new Map([['session', 'token']]);
		expect(await remove(PASSWORD, cookies)).toEqual({ redirect: '/anmelden' });
		expect(storage.deletePrefix).toHaveBeenCalledWith('a/');
		expect(await accountExists('a')).toBe(false);
		expect(await accountExists('b')).toBe(true);
		expect(cookies.size).toBe(0);
	});

	it('refuses a wrong or missing password and keeps the account', async () => {
		expect(await remove('falsch')).toEqual({
			fail: 400,
			data: { errors: { password: 'Das Passwort stimmt nicht.' } }
		});
		expect(await remove('')).toMatchObject({ fail: 400 });
		expect(await accountExists('a')).toBe(true);
	});

	it('is for owners only', async () => {
		await db.insert(users).values({
			id: 'manager-a',
			accountId: 'a',
			email: 'm@example.org',
			passwordHash: 'x',
			role: 'manager'
		});
		await setPassword(db, 'manager-a');
		expect(
			await outcome(() =>
				actions.delete(routeEvent(db, { user: managerA, form: { password: PASSWORD } }))
			)
		).toMatchObject({ error: 403 });
	});

	it('keeps the account while Stripe cannot cancel the subscription', async () => {
		Object.assign(env, { STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_ID: 'price' });
		await db.update(accounts).set({ stripeCustomerId: 'cus_a' }).where(eq(accounts.id, 'a'));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 500 }))
		);
		expect(await remove(PASSWORD)).toMatchObject({ fail: 502 });
		expect(await accountExists('a')).toBe(true);
	});

	it('keeps the account when its files cannot be deleted', async () => {
		storage.deletePrefix.mockRejectedValue(new Error('R2 nicht erreichbar'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await remove(PASSWORD)).toMatchObject({ fail: 503 });
		expect(await accountExists('a')).toBe(true);
	});
});
