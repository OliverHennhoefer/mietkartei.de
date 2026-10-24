import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate, createSession, validateSession } from './auth';
import type { Database } from './db';
import { auditLog, emailChanges, invitations, passwordResets, sessions, users } from './db/schema';
import {
	INVITATION_LIFETIME,
	INVITATION_RETENTION,
	MAX_ACCOUNT_MEMBERS,
	MAX_INVITATIONS_PER_DAY,
	acceptInvitation,
	createInvitation,
	deliverInvitation,
	findInvitation,
	freeSeats,
	invitationMail,
	inviterName,
	listAccountUsers,
	listPendingInvitations,
	removeUser,
	resendInvitation,
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

	it('refuses an address of the account or with an open or expired invitation', async () => {
		expect(await createInvitation(db, contextA, { email: 'A@example.org' }, now)).toEqual({
			ok: false,
			reason: 'member'
		});
		const { id } = await invite();
		expect(await createInvitation(db, contextA, { email: 'neu@example.org' }, now)).toEqual({
			ok: false,
			reason: 'already-invited'
		});
		// An expired invitation is sent again instead; a revoked one does not block a new one.
		expect(await createInvitation(db, contextA, { email: 'neu@example.org' }, later)).toEqual({
			ok: false,
			reason: 'already-invited'
		});
		await revokeInvitation(db, contextA, id, later);
		expect(await createInvitation(db, contextA, { email: 'neu@example.org' }, later)).toMatchObject(
			{ ok: true }
		);
	});

	it('refuses once users and open invitations fill the seats of the account', async () => {
		// The test account has its owner; the other seats go to open invitations.
		for (let index = 1; index < MAX_ACCOUNT_MEMBERS; index++)
			await invite(`p-${index}@example.org`);
		expect(await freeSeats(db, 'a', now)).toBe(0);
		expect(await createInvitation(db, contextA, { email: 'voll@example.org' }, now)).toEqual({
			ok: false,
			reason: 'full'
		});
		// Expired invitations free their seat.
		expect(await freeSeats(db, 'a', later)).toBe(MAX_ACCOUNT_MEMBERS - 1);
		expect(await invite('frei@example.org', contextB)).toMatchObject({ ok: true });
	});

	it('never fills more seats than there are, even for simultaneous invitations', async () => {
		for (let index = 2; index < MAX_ACCOUNT_MEMBERS; index++)
			await invite(`p-${index}@example.org`);
		expect(await freeSeats(db, 'a', now)).toBe(1);
		const results = await Promise.all(
			['x@example.org', 'y@example.org'].map((email) =>
				createInvitation(db, contextA, { email }, now)
			)
		);
		expect(results.filter((result) => result.ok).length).toBeLessThanOrEqual(1);
		expect(await freeSeats(db, 'a', now)).toBeGreaterThanOrEqual(0);
		const logged = await db.select().from(auditLog);
		expect(logged).toHaveLength((await listPendingInvitations(db, 'a', now)).length);
	});

	it('deletes invitations of every account a month after their expiry', async () => {
		const old = await invite('alt@example.org', contextB);
		const purgeAt = later + INVITATION_RETENTION + 1;
		await createInvitation(db, contextA, { email: 'neu@example.org' }, purgeAt);
		const rows = await db.select().from(invitations);
		expect(rows.map((row) => row.email)).toEqual(['neu@example.org']);
		expect(rows.some((row) => row.id === old.id)).toBe(false);
	});

	it('says nothing about users of other accounts; accepting refuses them', async () => {
		const { token } = await invite('B@example.org');
		expect(
			await acceptInvitation(db, token, { name: 'B', password: 'passwort-von-b' }, now)
		).toEqual({ ok: false, reason: 'email-taken' });
	});

	it('sends at most five invitations a day, revoked ones included', async () => {
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
	it('lists open and expired invitations and users of the account only', async () => {
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
		expect(pending.map((invitation) => [invitation.id, invitation.expired])).toEqual([
			[open.id, false]
		]);
		expect(
			(await listPendingInvitations(db, 'a', later)).map((invitation) => invitation.expired)
		).toEqual([true]);

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

describe('resendInvitation', () => {
	it('replaces an invitation with a new link and a new week, and logs it', async () => {
		const first = await invite();
		const resent = await resendInvitation(db, contextA, first.id, later);
		if (!resent.ok) throw new Error(resent.reason);
		expect(resent).toMatchObject({ email: 'neu@example.org' });
		expect(resent.token).not.toBe(first.token);
		expect(await findInvitation(db, first.token, later)).toBeUndefined();
		expect(await findInvitation(db, resent.token, later)).toMatchObject({ status: 'open' });
		const pending = await listPendingInvitations(db, 'a', later);
		expect(pending.map((invitation) => [invitation.id, invitation.expiresAt.getTime()])).toEqual([
			[resent.id, later + INVITATION_LIFETIME]
		]);
		const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, resent.id));
		expect(audit.map((entry) => entry.summary)).toEqual([
			'Einladung an neu@example.org erneut geschickt'
		]);
	});

	it('lets only one of two simultaneous resends replace the invitation', async () => {
		const first = await invite();
		const results = await Promise.all([
			resendInvitation(db, contextA, first.id, now),
			resendInvitation(db, contextA, first.id, now)
		]);
		expect(results.filter((result) => result.ok)).toHaveLength(1);
		expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: 'missing' }]);
		expect(await listPendingInvitations(db, 'a', now)).toHaveLength(1);
	});

	it('keeps the seat of a full account while it resends, even against a new invitation', async () => {
		const first = await invite('p-1@example.org');
		for (let index = 2; index < MAX_ACCOUNT_MEMBERS; index++)
			await invite(`p-${index}@example.org`);
		const [resent, created] = await Promise.all([
			resendInvitation(db, contextA, first.id, now),
			createInvitation(db, contextA, { email: 'neu@example.org' }, now)
		]);
		expect(resent.ok).toBe(true);
		expect(created).toEqual({ ok: false, reason: 'full' });
		expect(await freeSeats(db, 'a', now)).toBe(0);
	});

	it('refuses foreign, revoked and accepted invitations', async () => {
		const foreign = await invite('b-neu@example.org', contextB);
		expect(await resendInvitation(db, contextA, foreign.id, now)).toEqual({
			ok: false,
			reason: 'missing'
		});
		const revoked = await invite('eins@example.org');
		await revokeInvitation(db, contextA, revoked.id, now);
		expect(await resendInvitation(db, contextA, revoked.id, now)).toEqual({
			ok: false,
			reason: 'missing'
		});
		const accepted = await invite('zwei@example.org');
		await acceptInvitation(
			db,
			accepted.token,
			{ name: 'Zwei', password: 'passwort-von-zwei' },
			now
		);
		expect(await resendInvitation(db, contextA, accepted.id, now)).toEqual({
			ok: false,
			reason: 'missing'
		});
	});

	it('counts towards the daily limit, and an expired one needs a free seat', async () => {
		const first = await invite('eins@example.org');
		for (let index = 1; index < MAX_INVITATIONS_PER_DAY; index++) {
			const resent = await resendInvitation(db, contextA, first.id, now);
			if (!resent.ok) throw new Error(resent.reason);
			first.id = resent.id;
		}
		expect(await resendInvitation(db, contextA, first.id, now)).toEqual({
			ok: false,
			reason: 'too-many'
		});

		const day = 24 * 60 * 60 * 1000;
		const expiredAt = now + INVITATION_LIFETIME + day;
		for (let index = 1; index < MAX_ACCOUNT_MEMBERS; index++) {
			const result = await createInvitation(
				db,
				contextA,
				{ email: `p-${index}@example.org` },
				expiredAt + index * day
			);
			if (!result.ok) throw new Error(result.reason);
		}
		expect(await resendInvitation(db, contextA, first.id, expiredAt + 5 * day)).toEqual({
			ok: false,
			reason: 'full'
		});
	});
});

describe('deliverInvitation', () => {
	const mail = { to: 'neu@example.org', subject: 'Einladung', text: 'Link' };

	it('sends the mail and keeps the invitation', async () => {
		const created = await invite();
		const send = vi.fn(async () => {});
		expect(await deliverInvitation(db, contextA, created.id, mail, send)).toBe(true);
		expect(send).toHaveBeenCalledWith(mail);
		expect(await listPendingInvitations(db, 'a', now)).toHaveLength(1);
	});

	it('revokes the invitation when the mail fails, so the address can be invited again', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const created = await invite();
		const failing = async () => {
			throw new Error('Mail provider answered 500');
		};
		expect(await deliverInvitation(db, contextA, created.id, mail, failing)).toBe(false);
		expect(await listPendingInvitations(db, 'a', now)).toEqual([]);
		expect(await findInvitation(db, created.token, now)).toBeUndefined();
		const again = await createInvitation(db, contextA, { email: 'neu@example.org' }, now);
		expect(again.ok).toBe(true);
		vi.restoreAllMocks();
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
		const own = await manager(contextA, 'eigener@example.org');
		expect(await removeUser(db, contextA, 'user-a')).toBe('self');
		// Only the owner reaches the page, so this guards against a caller that skipped the check.
		expect(await removeUser(db, { accountId: 'a', userId: own }, 'user-a')).toBe('owner');
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
