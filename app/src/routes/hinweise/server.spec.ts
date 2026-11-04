import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { dismissedHints } from '#lib/server/db/schema.ts';
import { hintKey } from '#lib/server/hints.ts';
import { outcome, ownerA, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { POST } from './+server';

let db: Database;
let key: string;

beforeEach(async () => {
	db = await testDatabase();
	key = await hintKey('steuer:p:2025', 'Text');
});

const keys = async () =>
	(await db.select({ key: dismissedHints.key }).from(dismissedHints)).map((row) => row.key);

describe('POST /hinweise', () => {
	it('closes a Hinweis and goes back to the page without JavaScript', async () => {
		const result = await outcome(() =>
			POST(routeEvent(db, { url: '/hinweise', form: { key, back: '/objekte/p/steuer?jahr=2025' } }))
		);
		expect(result).toEqual({ redirect: '/objekte/p/steuer?jahr=2025' });
		expect(await keys()).toEqual([key]);
	});

	it('answers the page’s fetch without a redirect', async () => {
		const body = new FormData();
		body.append('key', key);
		const event = {
			...(routeEvent(db, { url: '/hinweise' }) as object),
			request: new Request('http://localhost/hinweise', {
				method: 'POST',
				body,
				headers: { accept: 'application/json', origin: 'http://localhost' }
			})
		};
		const response = await POST(event as never);
		expect(response.status).toBe(204);
		expect(await keys()).toEqual([key]);
	});

	it('shows closed Hinweise again', async () => {
		await db.insert(dismissedHints).values({ accountId: 'a', userId: ownerA.id, key });
		await outcome(() =>
			POST(routeEvent(db, { url: '/hinweise', form: { key, restore: '1', back: '/' } }))
		);
		expect(await keys()).toEqual([]);
	});

	it('shows many closed Hinweise again in one post', async () => {
		const many = await Promise.all(
			Array.from({ length: 120 }, (_, index) => hintKey('x', String(index)))
		);
		await outcome(() => POST(routeEvent(db, { url: '/hinweise', form: { key: many } })));
		expect(await keys()).toHaveLength(120);
		await outcome(() =>
			POST(routeEvent(db, { url: '/hinweise', form: { key: many, restore: '1' } }))
		);
		expect(await keys()).toEqual([]);
	});

	it('returns only to a page of the app', async () => {
		for (const back of ['https://example.org/', '//example.org/', '/\\example.org']) {
			const result = await outcome(() =>
				POST(routeEvent(db, { url: '/hinweise', form: { key, back } }))
			);
			expect(result).toEqual({ redirect: '/' });
		}
	});

	it('refuses what is not a key', async () => {
		const result = await outcome(() =>
			POST(routeEvent(db, { url: '/hinweise', form: { key: 'abc' } }))
		);
		expect(result).toMatchObject({ error: 400 });
		const none = await outcome(() => POST(routeEvent(db, { url: '/hinweise', form: {} })));
		expect(none).toMatchObject({ error: 400 });
	});

	it('sends visitors to the sign-in', async () => {
		const result = await outcome(() =>
			POST(routeEvent(db, { url: '/hinweise', user: null, form: { key } }))
		);
		expect(result).toEqual({ redirect: '/anmelden' });
	});
});
