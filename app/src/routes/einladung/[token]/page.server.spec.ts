import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { users } from '#lib/server/db/schema.ts';
import { createInvitation } from '#lib/server/invitations.ts';
import { contextA, outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

let db: Database;
let token: string;

beforeEach(async () => {
	db = await testDatabase();
	const created = await createInvitation(db, contextA, { email: 'neu@example.org' });
	if (!created.ok) throw new Error(created.reason);
	token = created.token;
});

const form = { name: 'Max', password: 'lang-genug-1234', passwordConfirm: 'lang-genug-1234' };

function accept(fields: Record<string, string>, params = { token }) {
	const cookies = new Map<string, string>();
	return outcome(() =>
		actions.default(routeEvent(db, { user: null, params, form: fields, cookies }))
	);
}

describe('einladung', () => {
	it('shows the invited address and 404 for unknown links', async () => {
		expect(await outcome(() => load(routeEvent(db, { user: null, params: { token } })))).toEqual({
			data: { email: 'neu@example.org', status: 'open' }
		});
		expect(
			await outcome(() => load(routeEvent(db, { user: null, params: { token: 'x' } })))
		).toMatchObject({ error: 404 });
	});

	it('creates a manager of the inviting account and refuses the link a second time', async () => {
		expect(await accept(form)).toEqual({ redirect: '/' });
		const [user] = (await db.select().from(users)).filter((u) => u.email === 'neu@example.org');
		expect(user).toMatchObject({ accountId: 'a', role: 'manager', name: 'Max' });
		expect(await accept(form)).toEqual({ fail: 400, data: { refused: 'accepted' } });
	});

	it('answers 404 for an unknown link and 400 for an invalid form', async () => {
		expect(await accept(form, { token: 'x' })).toMatchObject({ error: 404 });
		expect(await accept({ ...form, passwordConfirm: 'anders' })).toMatchObject({ fail: 400 });
	});
});
