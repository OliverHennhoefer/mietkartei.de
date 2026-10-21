import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { authenticate, createSession, validateSession } from './auth';
import type { Database } from './db';
import { auditLog, emailChanges, invitations, passwordResets, sessions, users } from './db/schema';
import {
	INVITATION_LIFETIME,
	MAX_INVITATIONS_PER_DAY,
	acceptInvitation,
	createInvitation,
	findInvitation,
	invitationMail,
	inviterName,
	listAccountUsers,
	listPendingInvitations,
	removeUser,
	revokeInvitation
} from './invitations';
import { QUOTAS } from './quotas';
import { contextA, contextB, testDatabase } from './testing';

const now = Date.parse('2026-03-01T10:00:00Z');
const later = now + INVITATION_LIFETIME;

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

async function invite(email = 'Neu@Example.org', context = contextA) {
	const result = await createInvitation(db, context, { email }, now);
	if (!result.ok) throw new Error(result.reason);
	return result;
}

describe('createInvitation', () => {
	it('stores the hash of the token with a week of validity and logs the invitation', async () => {
		const result = await invite();
		expect(result).toMatchObject({ ok: true, email: 'neu@example.org' });
		const [row] = await db.select().from(invitations);
		expect(row).toMatchObject({
			id: result.id,
			accountId: 'a',
			email: 'neu@example.org',
			invitedBy: 'user-a',
			acceptedAt: null,
			revokedAt: null
		});
		expect(row.tokenHash).not.toBe(result.token);
		expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
		expect(row.expiresAt.getTime()).toBe(later);
		const audit = await db.select().from(auditLog);
		expect(
			audit.map((entry) => [entry.entity, entry.entityId, entry.action, entry.summary])
		).toEqual([['invitation', result.id, 'invite', 'neu@example.org als Mitverwalter eingeladen']]);
	});

	it('refuses an address of the account or with an open invitation', async () => {
		expect(await createInvitation(db, contextA, { email: 'A@example.org' }, now)).toEqual({
			ok: false,
			reason: 'member'
		});
		await invite();
		expect(await createInvitation(db, contextA, { email: 'neu@example.org' }, now)).toEqual({
			ok: false,
			reason: 'already-invited'
		});
		// An expired invitation does not block a new one.
		expect(await createInvitation(db, contextA, { email: 'neu@example.org' }, later)).toMatchObject(
			{ ok: true }
		);
	});

	it('says nothing about users of other accounts; accepting refuses them', async () => {
		const { token } = await invite('B@example.org');
		expect(
			await acceptInvitation(db, token, { name: 'B', password: 'passwort-von-b' }, now)
		).toEqual({ ok: false, reason: 'email-taken' });
	});

	it('sends at most twenty invitations a day, revoked ones included', async () => {
		for (let index = 0; index < MAX_INVITATIONS_PER_DAY; index++) {
			const { id } = await invite(`eins-${index}@example.org`);
			// Revoking frees neither the daily limit nor the quota.
			await revokeInvitation(db, contextA, id, now);
		}
		expect(await createInvitation(db, contextA, { email: 'noch@example.org' }, now)).toEqual({
			ok: false,
			reason: 'too-many'
		});
		expect(await db.select().from(invitations)).toHaveLength(MAX_INVITATIONS_PER_DAY);
		// Another account has its own limit, and a day later the account may invite again.
		expect(await invite('noch@example.org', contextB)).toMatchObject({ ok: true });
		expect(
			await createInvitation(db, contextA, { email: 'noch@example.org' }, now + 24 * 60 * 60 * 1000)
		).toMatchObject({ ok: true });
	});

	it('refuses with 409 once the account holds the most invitations it may', async () => {
		await db.insert(invitations).values(
			Array.from({ length: QUOTAS.invitations.max }, (_, index) => ({
				accountId: 'a',
				email: `alt-${index}@example.org`,
				tokenHash: `hash-${index}`,
				expiresAt: new Date(now)
			}))
		);
		const refusal = await invite().catch((error) => error);
		expect(isHttpError(refusal, 409)).toBe(true);
		expect(await invite('neu@example.org', contextB)).toMatchObject({ ok: true });
	});
});

describe('listPendingInvitations and listAccountUsers', () => {
	it('lists open invitations and users of the account only', async () => {
		const open = await invite('eins@example.org');
		await invite('zwei@example.org', contextB);
		const accepted = await invite('drei@example.org');
		await acceptInvitation(
			db,
			accepted.token,
			{ name: 'Drei', password: 'passwort-von-drei' },
			now
		);

		const pending = await listPendingInvitations(db, 'a', now);
		expect(pending.map((invitation) => invitation.id)).toEqual([open.id]);
		expect(await listPendingInvitations(db, 'a', later)).toEqual([]);

		const accountUsers = await listAccountUsers(db, 'a');
		expect(accountUsers.map((user) => [user.email, user.role, user.name])).toEqual([
			['a@example.org', 'owner', null],
			['drei@example.org', 'manager', 'Drei']
		]);
	});
});

describe('revokeInvitation', () => {
	it('revokes an open invitation of the account, whose link then leads nowhere, and logs it', async () => {
		const own = await invite('eins@example.org');
		const foreign = await invite('zwei@example.org', contextB);
		expect(await revokeInvitation(db, contextA, own.id, now)).toBe(true);
		expect(await revokeInvitation(db, contextA, foreign.id, now)).toBe(false);
		expect(await revokeInvitation(db, contextA, own.id, now)).toBe(false);
		const rows = await db.select().from(invitations);
		expect(rows.map((row) => [row.id, row.revokedAt?.getTime() ?? null])).toEqual([
			[own.id, now],
			[foreign.id, null]
		]);
		expect(await listPendingInvitations(db, 'a', now)).toEqual([]);
		expect(await findInvitation(db, own.token, now)).toBeUndefined();
		expect(
			await acceptInvitation(db, own.token, { name: 'Eins', password: 'passwort-von-eins' }, now)
		).toEqual({ ok: false, reason: 'invalid' });
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'delete'));
		expect(audit.map((entry) => [entry.accountId, entry.summary])).toEqual([
			['a', 'Einladung an eins@example.org zurückgezogen']
		]);
	});
});

describe('findInvitation and acceptInvitation', () => {
	it('tells an open, expired, accepted and unknown token apart', async () => {
		const { token } = await invite();
		expect(await findInvitation(db, token, now)).toMatchObject({
			accountId: 'a',
			email: 'neu@example.org',
			status: 'open'
		});
		expect((await findInvitation(db, token, later))!.status).toBe('expired');
		expect(await findInvitation(db, 'unbekannt', now)).toBeUndefined();
		await acceptInvitation(db, token, { name: 'Neu', password: 'passwort-von-neu' }, now);
		expect((await findInvitation(db, token, now))!.status).toBe('accepted');
	});

	it('creates the user in the inviting account as a manager and logs it', async () => {
		const { id, token } = await invite();
		const result = await acceptInvitation(
			db,
			token,
			{ name: ' Neu Mitverwalter ', password: 'passwort-von-neu' },
			now
		);
		expect(result).toMatchObject({ ok: true, accountId: 'a' });
		if (!result.ok) return;
		const [user] = await db.select().from(users).where(eq(users.id, result.userId));
		expect(user).toMatchObject({
			accountId: 'a',
			email: 'neu@example.org',
			role: 'manager',
			name: 'Neu Mitverwalter'
		});
		expect(await authenticate(db, 'neu@example.org', 'passwort-von-neu')).toBe(result.userId);
		const [row] = await db.select().from(invitations).where(eq(invitations.id, id));
		expect(row.acceptedAt?.getTime()).toBe(now);
		const audit = await db.select().from(auditLog).where(eq(auditLog.entity, 'user'));
		expect(
			audit.map((entry) => [entry.accountId, entry.userId, entry.action, entry.summary])
		).toEqual([
			[
				'a',
				result.userId,
				'create',
				'Neu Mitverwalter hat die Einladung angenommen und ist jetzt Mitverwalter'
			]
		]);
	});

	it('refuses expired, used and unknown tokens and an address taken in the meantime', async () => {
		const { token } = await invite();
		expect(
			await acceptInvitation(db, token, { name: 'Neu', password: 'passwort-von-neu' }, later)
		).toEqual({ ok: false, reason: 'expired' });
		expect(
			await acceptInvitation(db, 'unbekannt', { name: 'Neu', password: 'passwort-von-neu' }, now)
		).toEqual({ ok: false, reason: 'invalid' });
		await db.insert(users).values({
			accountId: 'b',
			email: 'neu@example.org',
			passwordHash: 'x',
			role: 'manager'
		});
		expect(
			await acceptInvitation(db, token, { name: 'Neu', password: 'passwort-von-neu' }, now)
		).toEqual({ ok: false, reason: 'email-taken' });
		await db.delete(users).where(eq(users.email, 'neu@example.org'));
		expect(
			await acceptInvitation(db, token, { name: 'Neu', password: 'passwort-von-neu' }, now)
		).toMatchObject({ ok: true });
		expect(
			await acceptInvitation(db, token, { name: 'Noch', password: 'passwort-von-noch' }, now)
		).toEqual({ ok: false, reason: 'accepted' });
		expect(await db.select().from(users).where(eq(users.email, 'neu@example.org'))).toHaveLength(1);
	});
});

describe('removeUser', () => {
	async function manager(context = contextA, email = 'neu@example.org') {
		const { token } = await invite(email, context);
		const result = await acceptInvitation(
			db,
			token,
			{ name: 'Neu', password: 'passwort-von-neu' },
			now
		);
		if (!result.ok) throw new Error(result.reason);
		return result.userId;
	}

	it('deletes the user with sessions, resets and address changes, keeps the history and logs it', async () => {
		const userId = await manager();
		const session = await createSession(db, userId);
		await db.insert(passwordResets).values({ id: 'r', userId, expiresAt: new Date(later) });
		await db.insert(emailChanges).values({
			id: 'c',
			accountId: 'a',
			userId,
			email: 'anders@example.org',
			expiresAt: new Date(later)
		});

		expect(await removeUser(db, contextA, userId)).toBe('removed');
		expect(await db.select().from(users).where(eq(users.id, userId))).toEqual([]);
		expect(await validateSession(db, session.token)).toBeUndefined();
		expect(await db.select().from(sessions)).toEqual([]);
		expect(await db.select().from(passwordResets)).toEqual([]);
		expect(await db.select().from(emailChanges)).toEqual([]);
		// The invitation the user accepted stays, now pointing at nobody.
		expect(await db.select().from(invitations)).toHaveLength(1);
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'delete'));
		expect(audit.map((entry) => [entry.userId, entry.entityId, entry.summary])).toEqual([
			['user-a', userId, 'Mitverwalter Neu entfernt']
		]);
		// The user's own entry keeps the account's history, without the user.
		const created = await db.select().from(auditLog).where(eq(auditLog.action, 'create'));
		expect(created[0].userId).toBeNull();
	});

	it('neither removes oneself, an owner nor a user of another account', async () => {
		const foreign = await manager(contextB);
		await db.insert(users).values({
			id: 'owner-a',
			accountId: 'a',
			email: 'zweiter-vermieter@example.org',
			passwordHash: 'x',
			role: 'owner'
		});
		expect(await removeUser(db, contextA, 'user-a')).toBe('self');
		expect(await removeUser(db, contextA, 'owner-a')).toBe('owner');
		expect(await removeUser(db, contextA, foreign)).toBe('missing');
		expect(await removeUser(db, contextA, 'user-b')).toBe('missing');
		expect(await db.select().from(users)).toHaveLength(4);
	});
});

describe('invitationMail', () => {
	it('names the inviter, the role and the link', () => {
		const mail = invitationMail('neu@example.org', 'https://app.example/einladung/t0k', 'Erika');
		expect(mail.to).toBe('neu@example.org');
		expect(mail.text).toContain('Erika lädt dich ein');
		expect(mail.text).toContain('Mitverwalter');
		expect(mail.text).toContain('https://app.example/einladung/t0k');
	});

	it('prints nothing of the name that a mail program would turn into a link', () => {
		const mail = invitationMail(
			'neu@example.org',
			'https://app.example/einladung/t0k',
			'Klicke https://evil.example/x oder www.evil.example\nboese.example.org, Erika'
		);
		expect(mail.text).toContain('Klicke oder Erika lädt dich ein');
		expect(mail.text).not.toMatch(/evil|boese/);
	});
});

describe('inviterName', () => {
	it('keeps an ordinary name and falls back to Jemand', () => {
		expect(inviterName('Dr. Erika Müller-Lüdenscheidt')).toBe('Dr. Erika Müller-Lüdenscheidt');
		expect(inviterName(null)).toBe('Jemand');
		expect(inviterName('  ')).toBe('Jemand');
		expect(inviterName('https://evil.example')).toBe('Jemand');
		expect(inviterName('mail@evil.example')).toBe('Jemand');
		expect(inviterName('evil.рф')).toBe('Jemand');
	});

	it('keeps one line of at most 60 characters', () => {
		expect(inviterName('Erika\r\nMustermann')).toBe('Erika Mustermann');
		expect(inviterName('x'.repeat(100))).toHaveLength(60);
	});
});
