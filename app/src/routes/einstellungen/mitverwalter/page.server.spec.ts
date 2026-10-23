import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { invitations, outbox, users } from '#lib/server/db/schema.ts';
import { createInvitation } from '#lib/server/invitations.ts';
import { contextA, managerA, outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const env = vi.hoisted(() => ({ ORIGIN: '', MAIL_TRANSPORT: 'outbox' }));
vi.mock('$app/env/private', () => env);

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	Object.assign(env, { ORIGIN: '', MAIL_TRANSPORT: 'outbox' });
	await db.insert(users).values({
		id: 'manager-a',
		accountId: 'a',
		email: 'm@example.org',
		passwordHash: 'x',
		role: 'manager'
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

function invite(email: string, url?: string) {
	return outcome(() => actions.invite(routeEvent(db, { form: { email }, url })));
}

describe('mitverwalter', () => {
	it('is for owners only', async () => {
		const manager = { user: managerA, form: { email: 'x@example.org' } };
		expect(await outcome(() => load(routeEvent(db, { user: managerA })))).toMatchObject({
			error: 403
		});
		for (const action of [actions.invite, actions.revoke, actions.remove]) {
			expect(await outcome(() => action(routeEvent(db, manager)))).toMatchObject({ error: 403 });
		}
	});

	it('lists the users and open invitations of the account', async () => {
		await createInvitation(db, contextA, { email: 'neu@example.org' });
		const result = await outcome(() => load(routeEvent(db)));
		expect(result).toMatchObject({
			data: {
				userId: 'user-a',
				users: [expect.anything(), expect.anything()],
				invitations: [{ email: 'neu@example.org' }]
			}
		});
	});

	it('mails an invitation link', async () => {
		expect(await invite('neu@example.org')).toEqual({ data: { invited: 'neu@example.org' } });
		const [mail] = await db.select().from(outbox);
		expect(mail.to).toBe('neu@example.org');
		expect(mail.text).toMatch(/http:\/\/localhost\/einladung\/[\w-]{43}/);
	});

	it('refuses members, repeated and unsendable invitations', async () => {
		expect(await invite('m@example.org')).toMatchObject({
			fail: 400,
			data: { errors: { email: expect.stringContaining('schon einen Zugang') } }
		});
		await invite('neu@example.org');
		expect(await invite('neu@example.org')).toMatchObject({
			fail: 400,
			data: { errors: { email: expect.stringContaining('schon eingeladen') } }
		});
		expect(await invite('kaputt')).toMatchObject({ fail: 400 });

		vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await invite('dritte@example.org', 'http://evil.example/')).toMatchObject({ fail: 503 });
	});

	it('withdraws an invitation whose mail could not be sent', async () => {
		env.MAIL_TRANSPORT = 'resend';
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('down', { status: 500 }));
		expect(await invite('neu@example.org')).toMatchObject({ fail: 502 });
		expect(await outcome(() => load(routeEvent(db)))).toMatchObject({ data: { invitations: [] } });
	});

	it('revokes an invitation once', async () => {
		const created = await createInvitation(db, contextA, { email: 'neu@example.org' });
		if (!created.ok) throw new Error(created.reason);
		const revoke = (invitationId: string) =>
			outcome(() => actions.revoke(routeEvent(db, { form: { invitationId } })));
		expect(await revoke(created.id)).toEqual({ data: { revoked: true } });
		expect(await revoke(created.id)).toMatchObject({ fail: 404 });
		expect(await revoke('')).toMatchObject({ fail: 400 });
		expect(await db.select().from(invitations)).toHaveLength(1);
	});

	it('removes managers, but neither oneself nor another account’s user', async () => {
		const remove = (userId: string) =>
			outcome(() => actions.remove(routeEvent(db, { form: { userId } })));
		expect(await remove('user-a')).toMatchObject({ fail: 400 });
		expect(await remove('user-b')).toMatchObject({ fail: 404 });
		expect(await remove('')).toMatchObject({ fail: 400 });
		expect(await remove('manager-a')).toEqual({ data: { removed: true } });
		expect((await db.select().from(users)).map((user) => user.id).sort()).toEqual([
			'user-a',
			'user-b'
		]);
	});
});
