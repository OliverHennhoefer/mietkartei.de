import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { auditLog, invitations, outbox, users } from '#lib/server/db/schema.ts';
import { createInvitation, leaveAccount, transferOwnership } from '#lib/server/invitations.ts';
import {
	contextA,
	managerA,
	outcome,
	PASSWORD,
	routeEvent,
	setPassword,
	testDatabase
} from '#lib/server/testing.ts';
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
		for (const action of [
			actions.invite,
			actions.resend,
			actions.revoke,
			actions.role,
			actions.remove,
			actions.transfer
		]) {
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
				invitations: [{ email: 'neu@example.org', expired: false }],
				freeSeats: 2,
				maxMembers: 5
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

	it('sends an invitation again with a new link', async () => {
		const created = await createInvitation(db, contextA, { email: 'neu@example.org' });
		if (!created.ok) throw new Error(created.reason);
		const resend = (invitationId: string) =>
			outcome(() => actions.resend(routeEvent(db, { form: { invitationId } })));
		expect(await resend(created.id)).toEqual({ data: { invited: 'neu@example.org' } });
		const [mail] = await db.select().from(outbox);
		expect(mail.to).toBe('neu@example.org');
		expect(mail.text).toMatch(/http:\/\/localhost\/einladung\/[\w-]{43}/);
		expect(await resend(created.id)).toMatchObject({ fail: 404 });
		expect(await resend('')).toMatchObject({ fail: 400 });
	});

	it('refuses to invite beyond the seats of the account', async () => {
		await invite('eins@example.org');
		await invite('zwei@example.org');
		await invite('drei@example.org');
		expect(await invite('vier@example.org')).toMatchObject({
			fail: 400,
			data: { errors: { email: expect.stringContaining('höchstens 5 Zugänge') } }
		});
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

	it('invites a viewer and changes the role of a member', async () => {
		expect(
			await outcome(() =>
				actions.invite(routeEvent(db, { form: { email: 'leser@example.org', role: 'viewer' } }))
			)
		).toEqual({ data: { invited: 'leser@example.org' } });
		const [mail] = await db.select().from(outbox);
		expect(mail.text).toContain('mit Lesezugriff');
		const role = (userId: string, role: string) =>
			outcome(() => actions.role(routeEvent(db, { form: { userId, role } })));
		expect(await role('manager-a', 'viewer')).toEqual({ data: { roleChanged: true } });
		const [manager] = await db.select().from(users).where(eq(users.id, 'manager-a'));
		expect(manager.role).toBe('viewer');
		expect(await role('manager-a', 'owner')).toMatchObject({ fail: 400 });
		expect(await role('user-a', 'viewer')).toMatchObject({ fail: 400 });
		expect(await role('user-b', 'viewer')).toMatchObject({ fail: 404 });
	});

	it('removes managers, but neither oneself nor another account’s user', async () => {
		const remove = (userId: string) =>
			outcome(() => actions.remove(routeEvent(db, { form: { userId } })));
		expect(await remove('user-a')).toMatchObject({ fail: 400 });
		expect(await remove('user-b')).toMatchObject({ fail: 404 });
		expect(await remove('')).toMatchObject({ fail: 400 });
		expect(await remove('manager-a')).toEqual({ data: { removed: true } });
		const [mail] = await db.select().from(outbox);
		expect(mail).toMatchObject({
			to: 'm@example.org',
			subject: 'Dein Zugang zu mietkartei wurde beendet'
		});
		expect((await db.select().from(users)).map((user) => user.id).sort()).toEqual([
			'user-a',
			'user-b'
		]);
	});
});

describe('transfer', () => {
	function transfer(userId: string, password: string) {
		return outcome(() => actions.transfer(routeEvent(db, { form: { userId, password } })));
	}

	it('hands the account over after the password and mails the new owner', async () => {
		await setPassword(db, 'user-a');
		expect(await transfer('manager-a', 'falsch')).toMatchObject({ fail: 400 });
		expect(await transfer('user-b', PASSWORD)).toMatchObject({ fail: 404 });
		expect(await transfer('manager-a', PASSWORD)).toEqual({ redirect: '/' });
		const roles = await db.select({ id: users.id, role: users.role }).from(users);
		expect(
			roles.filter((user) => user.id !== 'user-b').sort((a, b) => a.id.localeCompare(b.id))
		).toEqual([
			{ id: 'manager-a', role: 'owner' },
			{ id: 'user-a', role: 'manager' }
		]);
		const [mail] = await db.select().from(outbox);
		expect(mail).toMatchObject({
			to: 'm@example.org',
			subject: 'Du bist jetzt Vermieter in mietkartei'
		});
	});

	// The batch runs after the members were read; `before` changes the database in between.
	function racing(before: () => void): Database {
		return new Proxy(db, {
			get(target, property) {
				const value = Reflect.get(target, property);
				if (property !== 'transaction') return value;
				return (fn: () => void) => {
					before();
					return target.transaction(fn);
				};
			}
		});
	}

	it('keeps the owner when the member leaves during the handover', async () => {
		const gone = racing(() => db.delete(users).where(eq(users.id, 'manager-a')).run());
		expect(await transferOwnership(gone, contextA, 'manager-a')).toEqual({
			ok: false,
			reason: 'missing'
		});
		const [owner] = await db.select({ role: users.role }).from(users).where(eq(users.id, 'user-a'));
		expect(owner.role).toBe('owner');
		expect(await db.select().from(auditLog)).toEqual([]);
	});

	it('does not delete a member who became the owner in the meantime', async () => {
		const promoted = racing(() => {
			db.update(users).set({ role: 'manager' }).where(eq(users.id, 'user-a')).run();
			db.update(users).set({ role: 'owner' }).where(eq(users.id, 'manager-a')).run();
		});
		await leaveAccount(promoted, { accountId: 'a', userId: 'manager-a' });
		const [owner] = await db
			.select({ role: users.role })
			.from(users)
			.where(eq(users.id, 'manager-a'));
		expect(owner.role).toBe('owner');
	});
});
