import { beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '#lib/server/auth.ts';
import type { Database } from '#lib/server/db/index.ts';
import { sessions, users } from '#lib/server/db/schema.ts';
import { requestEmailChange } from '#lib/server/email-changes.ts';
import {
	contextA,
	ownerA,
	outcome,
	PASSWORD,
	routeEvent,
	setPassword,
	testDatabase
} from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

let db: Database;
let token: string;

beforeEach(async () => {
	db = await testDatabase();
	await setPassword(db, 'user-a');
	const requested = await requestEmailChange(db, contextA, {
		email: 'neu@example.org',
		currentPassword: PASSWORD
	});
	if (!requested.ok) throw new Error(requested.reason);
	token = requested.token;
});

describe('e-mail-bestaetigen', () => {
	it('shows the new address and 404 for unknown links', async () => {
		expect(await outcome(() => load(routeEvent(db, { params: { token } })))).toEqual({
			data: { email: 'neu@example.org' }
		});
		expect(await outcome(() => load(routeEvent(db, { params: { token: 'x' } })))).toMatchObject({
			error: 404
		});
	});

	it('changes the address and keeps only the session of this browser', async () => {
		const mine = await createSession(db, 'user-a');
		await createSession(db, 'user-a');
		const cookies = new Map([['session', mine.token]]);
		expect(
			await outcome(() => actions.default(routeEvent(db, { params: { token }, cookies })))
		).toEqual({ redirect: '/einstellungen/profil' });
		const [user] = (await db.select().from(users)).filter((u) => u.id === 'user-a');
		expect(user.email).toBe('neu@example.org');
		expect(await db.select().from(sessions)).toHaveLength(1);
	});

	it('sends a visitor or another user to the sign-in page', async () => {
		const other = { ...ownerA, id: 'user-b', accountId: 'b' };
		expect(
			await outcome(() => actions.default(routeEvent(db, { user: other, params: { token } })))
		).toEqual({ redirect: '/anmelden' });
	});

	it('refuses an address taken in the meantime, and unknown links', async () => {
		await db
			.insert(users)
			.values({ accountId: 'b', email: 'neu@example.org', passwordHash: 'x', role: 'manager' });
		expect(await outcome(() => actions.default(routeEvent(db, { params: { token } })))).toEqual({
			fail: 400,
			data: { taken: true }
		});
		expect(
			await outcome(() => actions.default(routeEvent(db, { params: { token: 'x' } })))
		).toMatchObject({ error: 404 });
	});
});
