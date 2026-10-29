import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateSession } from '#lib/server/auth.ts';
import { DEMO_STARTS_PER_HOUR } from '#lib/server/demo-accounts.ts';
import { accounts, users } from '#lib/server/db/schema.ts';
import type { Database } from '#lib/server/db/index.ts';
import { memoryStorage, outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const env = vi.hoisted(() => ({
	DEMO: true,
	GENESIS_API_TOKEN: '',
	TURNSTILE_SITE_KEY: '',
	TURNSTILE_SECRET_KEY: ''
}));
vi.mock('$app/env/private', () => env);
vi.mock('#lib/server/storage/index.ts', () => ({
	accountPrefix: (accountId: string) => `${accountId}/`,
	storageKey: (accountId: string, documentId: string) => `${accountId}/${documentId}`,
	getStorage: async () => memoryStorage()
}));

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	Object.assign(env, { DEMO: true, TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' });
	vi.unstubAllGlobals();
});

describe('load', () => {
	it('is only there on the demo instance', async () => {
		env.DEMO = false;
		expect(await outcome(() => load(routeEvent(db, { user: null })))).toMatchObject({ error: 404 });
	});

	it('sends a visitor with a demo running into it', async () => {
		expect(await outcome(() => load(routeEvent(db)))).toEqual({ redirect: '/' });
		expect(await outcome(() => load(routeEvent(db, { user: null })))).toEqual({
			data: { turnstileSiteKey: null }
		});
		Object.assign(env, { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' });
		expect(await outcome(() => load(routeEvent(db, { user: null })))).toEqual({
			data: { turnstileSiteKey: 'site' }
		});
	});
});

describe('starting the demo', () => {
	it('signs the visitor into a new demo account', async () => {
		const cookies = new Map<string, string>();
		const result = await outcome(() =>
			actions.default(routeEvent(db, { user: null, form: {}, cookies }))
		);
		expect(result).toEqual({ redirect: '/' });
		const [token] = [...cookies.values()];
		const session = await validateSession(db, token);
		expect(session?.user.email).toMatch(/@demo\.invalid$/);
	});

	it('refuses on any other instance', async () => {
		env.DEMO = false;
		const result = await outcome(() => actions.default(routeEvent(db, { user: null, form: {} })));
		expect(result).toMatchObject({ error: 404 });
	});

	it('asks the visitor to come back when the demos of the last hour reached the limit', async () => {
		const ids = Array.from({ length: DEMO_STARTS_PER_HOUR }, () => crypto.randomUUID());
		await db.insert(accounts).values(ids.map((id) => ({ id, name: 'Demo' })));
		await db.insert(users).values(
			ids.map((id) => ({
				accountId: id,
				email: `demo-${id}@demo.invalid`,
				passwordHash: '!',
				name: 'Demo'
			}))
		);
		const result = await outcome(() => actions.default(routeEvent(db, { user: null, form: {} })));
		expect(result).toEqual({ fail: 503, data: { busy: true } });
	});

	it('starts only for a visitor the bot check confirms, when it is on', async () => {
		Object.assign(env, { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' });
		const verify = vi.fn(async () => Response.json({ success: false }));
		vi.stubGlobal('fetch', verify);
		const start = () =>
			outcome(() =>
				actions.default(routeEvent(db, { user: null, form: { 'cf-turnstile-response': 'token' } }))
			);
		expect(await start()).toEqual({ fail: 400, data: { botCheckFailed: true } });
		verify.mockResolvedValue(Response.json({ success: true }));
		expect(await start()).toEqual({ redirect: '/' });
		expect(verify).toHaveBeenCalledTimes(2);
	});
});
