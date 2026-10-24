import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { accounts, auditLog, documents, outbox, properties, users } from '#lib/server/db/schema.ts';
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
	BILLING_REQUIRED: false,
	MAIL_TRANSPORT: 'outbox'
}));
vi.mock('$app/env/private', () => env);

const storage = vi.hoisted(() => ({
	deletePrefix: vi.fn<(prefix: string) => Promise<void>>(async () => {}),
	delete: vi.fn<(key: string) => Promise<void>>(async () => {})
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
	storage.delete.mockReset();
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

	it('tells the other users that their access ended', async () => {
		await db.insert(users).values({
			id: 'manager-a',
			accountId: 'a',
			email: 'm@example.org',
			passwordHash: 'x',
			role: 'manager'
		});
		expect(await remove(PASSWORD)).toEqual({ redirect: '/anmelden' });
		const mails = await db.select().from(outbox);
		expect(mails.map((mail) => [mail.to, mail.subject])).toEqual([
			['m@example.org', 'Dein Zugang zu mietkartei wurde beendet']
		]);
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

describe('reset', () => {
	function reset(form: Record<string, string>, user?: typeof managerA) {
		return outcome(() => actions.reset(routeEvent(db, { user, form })));
	}

	async function propertyCount() {
		return (await db.select().from(properties).where(eq(properties.accountId, 'a'))).length;
	}

	it('deletes the data after the typed word and the password and keeps the account', async () => {
		await seedUnit(db, 'a');
		await seedUnit(db, 'b');
		expect(await reset({ confirmation: 'zurücksetzen', password: PASSWORD })).toEqual({
			redirect: '/'
		});
		expect(await propertyCount()).toBe(0);
		expect(await accountExists('a')).toBe(true);
		expect(await db.select().from(users).where(eq(users.id, 'user-a'))).toHaveLength(1);
		expect(await db.select().from(properties).where(eq(properties.accountId, 'b'))).toHaveLength(1);
		// Only the files of the documents go, never the whole prefix.
		expect(storage.deletePrefix).not.toHaveBeenCalled();
	});

	it('refuses a missing word or a wrong password and keeps the data', async () => {
		await seedUnit(db, 'a');
		expect(await reset({ confirmation: 'ja', password: PASSWORD })).toEqual({
			fail: 400,
			data: { resetErrors: { confirmation: 'Bitte tippe ZURÜCKSETZEN zur Bestätigung.' } }
		});
		expect(await reset({ confirmation: 'ZURÜCKSETZEN', password: 'falsch' })).toEqual({
			fail: 400,
			data: { resetErrors: { password: 'Das Passwort stimmt nicht.' } }
		});
		expect(await propertyCount()).toBe(1);
	});

	it('keeps the data when the files cannot be deleted', async () => {
		await seedUnit(db, 'a');
		await db.insert(documents).values({
			accountId: 'a',
			name: 'Beleg.pdf',
			mimeType: 'application/pdf',
			size: 1,
			storageKey: 'a/beleg'
		});
		storage.delete.mockRejectedValue(new Error('R2 nicht erreichbar'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await reset({ confirmation: 'ZURÜCKSETZEN', password: PASSWORD })).toMatchObject({
			fail: 503
		});
		expect(await propertyCount()).toBe(1);
	});

	it('is for owners only', async () => {
		await seedUnit(db, 'a');
		for (const role of ['manager', 'viewer'] as const) {
			await db.insert(users).values({
				id: `${role}-a`,
				accountId: 'a',
				email: `${role}@example.org`,
				passwordHash: 'x',
				role
			});
			await setPassword(db, `${role}-a`);
			expect(
				await reset(
					{ confirmation: 'ZURÜCKSETZEN', password: PASSWORD },
					{ ...managerA, id: `${role}-a`, role }
				)
			).toMatchObject({ error: 403 });
		}
		expect(await propertyCount()).toBe(1);
	});
});

describe('leave', () => {
	beforeEach(async () => {
		await db.insert(users).values({
			id: 'manager-a',
			accountId: 'a',
			email: 'm@example.org',
			passwordHash: 'x',
			role: 'manager',
			name: 'Max'
		});
		await setPassword(db, 'manager-a');
	});

	function leave(user: typeof managerA, password: string, cookies = new Map<string, string>()) {
		return outcome(() => actions.leave(routeEvent(db, { user, form: { password }, cookies })));
	}

	it('ends a manager’s access after the password and signs out', async () => {
		expect(await leave(managerA, 'falsch')).toMatchObject({ fail: 400 });
		const cookies = new Map([['session', 'token']]);
		expect(await leave(managerA, PASSWORD, cookies)).toEqual({ redirect: '/anmelden' });
		expect(cookies.size).toBe(0);
		expect((await db.select().from(users)).map((user) => user.id).sort()).toEqual([
			'user-a',
			'user-b'
		]);
		const [entry] = await db.select().from(auditLog).where(eq(auditLog.entityId, 'manager-a'));
		expect(entry).toMatchObject({ userId: null, summary: 'Max hat das Konto verlassen' });
		expect(await accountExists('a')).toBe(true);
	});

	it('refuses the owner', async () => {
		expect(
			await outcome(() => actions.leave(routeEvent(db, { form: { password: PASSWORD } })))
		).toMatchObject({
			fail: 400
		});
		expect(await db.select().from(users).where(eq(users.id, 'user-a'))).toHaveLength(1);
	});
});
