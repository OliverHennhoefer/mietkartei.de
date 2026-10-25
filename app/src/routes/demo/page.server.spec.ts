import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateSession } from '#lib/server/auth.ts';
import type { Database } from '#lib/server/db/index.ts';
import { memoryStorage, outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const env = vi.hoisted(() => ({ DEMO: true, GENESIS_API_TOKEN: '' }));
vi.mock('$app/env/private', () => env);
vi.mock('#lib/server/storage/index.ts', () => ({
	accountPrefix: (accountId: string) => `${accountId}/`,
	getStorage: async () => memoryStorage()
}));

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	env.DEMO = true;
});

describe('load', () => {
	it('is only there on the demo instance', async () => {
		env.DEMO = false;
		expect(await outcome(() => load(routeEvent(db, { user: null })))).toMatchObject({ error: 404 });
	});

	it('sends a visitor with a demo running into it', async () => {
		expect(await outcome(() => load(routeEvent(db)))).toEqual({ redirect: '/' });
		expect(await outcome(() => load(routeEvent(db, { user: null })))).toEqual({ data: undefined });
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
});
