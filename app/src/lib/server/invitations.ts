import { and, asc, count, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { userRoleLabels } from '../labels';
import { auditEntry, type AuditContext } from './audit';
import { generateToken, hashPassword, hashToken, normalizeEmail } from './auth';
import type { Database } from './db';
import { runBatch } from './db/batch';
import {
	emailChanges,
	invitations,
	passwordResets,
	sessions,
	users,
	type UserRole
} from './db/schema';
import type { Mail } from './mail';
import { assertQuota } from './quotas';

// Invitations (Mitverwalter einladen): the owner invites an address as a manager; an account has
// exactly one owner. The mail holds a random token, the database only its SHA-256. The invitee
// registers through the link into the inviting account, whatever REGISTRATION_EMAILS says. Links
// are valid for seven days.

const DAY = 24 * 60 * 60 * 1000;
export const INVITATION_LIFETIME = 7 * DAY;
/** Invitations an account may send per day, revoked ones included; each one sends a mail. */
export const MAX_INVITATIONS_PER_DAY = 20;

export type AccountUser = {
	id: string;
	email: string;
	name: string | null;
	role: UserRole;
	createdAt: Date;
};

/** The users of the account, owners first, then by name. */
export async function listAccountUsers(db: Database, accountId: string): Promise<AccountUser[]> {
	return db
		.select({
			id: users.id,
			email: users.email,
			name: users.name,
			role: users.role,
			createdAt: users.createdAt
		})
		.from(users)
		.where(eq(users.accountId, accountId))
		.orderBy(
			sql`case ${users.role} when 'owner' then 0 else 1 end`,
			asc(users.name),
			asc(users.email)
		);
}

export type PendingInvitation = {
	id: string;
	email: string;
	expiresAt: Date;
	createdAt: Date;
};

/** Invitations of the account that are neither accepted, revoked nor expired, newest first. */
export async function listPendingInvitations(
	db: Database,
	accountId: string,
	now = Date.now()
): Promise<PendingInvitation[]> {
	return db
		.select({
			id: invitations.id,
			email: invitations.email,
			expiresAt: invitations.expiresAt,
			createdAt: invitations.createdAt
		})
		.from(invitations)
		.where(
			and(
				eq(invitations.accountId, accountId),
				isNull(invitations.acceptedAt),
				isNull(invitations.revokedAt),
				gt(invitations.expiresAt, new Date(now))
			)
		)
		.orderBy(desc(invitations.createdAt));
}

export type InvitationInput = { email: string };

export type CreateInvitationResult =
	| { ok: true; id: string; email: string; token: string }
	| { ok: false; reason: 'member' | 'already-invited' | 'too-many' };

/**
 * Invites an address as a manager. Refused when a user of the account has the address, when the
 * account has an open invitation for it (the owner revokes that one first) or has sent
 * MAX_INVITATIONS_PER_DAY within a day. An address with a user in another account is invited all
 * the same, so the answer says nothing about other accounts; accepting refuses it later.
 * Returns the token for the mail, which is never stored.
 */
export async function createInvitation(
	db: Database,
	context: AuditContext,
	input: InvitationInput,
	now = Date.now()
): Promise<CreateInvitationResult> {
	await assertQuota(db, context.accountId, 'invitations');
	const email = normalizeEmail(input.email);
	const [member] = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.accountId, context.accountId), eq(users.email, email)));
	if (member) return { ok: false, reason: 'member' };
	const pending = await listPendingInvitations(db, context.accountId, now);
	if (pending.some((invitation) => invitation.email === email)) {
		return { ok: false, reason: 'already-invited' };
	}
	const [recent] = await db
		.select({ value: count() })
		.from(invitations)
		.where(
			and(
				eq(invitations.accountId, context.accountId),
				gt(invitations.createdAt, new Date(now - DAY))
			)
		);
	if (recent.value >= MAX_INVITATIONS_PER_DAY) return { ok: false, reason: 'too-many' };
	const id = crypto.randomUUID();
	const token = generateToken();
	await runBatch(db, [
		db.insert(invitations).values({
			id,
			accountId: context.accountId,
			email,
			tokenHash: await hashToken(token),
			expiresAt: new Date(now + INVITATION_LIFETIME),
			invitedBy: context.userId,
			createdAt: new Date(now)
		}),
		auditEntry(
			db,
			context,
			'invitation',
			id,
			'invite',
			`${email} als ${userRoleLabels.manager} eingeladen`
		)
	]);
	return { ok: true, id, email, token };
}

/**
 * Revokes an open invitation of the account; its link then leads nowhere. The row stays, so the
 * daily limit counts it. False when there is no such invitation.
 */
export async function revokeInvitation(
	db: Database,
	context: AuditContext,
	invitationId: string,
	now = Date.now()
): Promise<boolean> {
	const [invitation] = await db
		.select({ id: invitations.id, email: invitations.email })
		.from(invitations)
		.where(
			and(
				eq(invitations.accountId, context.accountId),
				eq(invitations.id, invitationId),
				isNull(invitations.acceptedAt),
				isNull(invitations.revokedAt)
			)
		);
	if (!invitation) return false;
	await runBatch(db, [
		db
			.update(invitations)
			.set({ revokedAt: new Date(now) })
			.where(eq(invitations.id, invitation.id)),
		auditEntry(
			db,
			context,
			'invitation',
			invitation.id,
			'delete',
			`Einladung an ${invitation.email} zurückgezogen`
		)
	]);
	return true;
}

export type InvitationStatus = 'open' | 'expired' | 'accepted';

export type FoundInvitation = {
	id: string;
	accountId: string;
	email: string;
	status: InvitationStatus;
};

/**
 * The invitation behind a token, with whether it can still be used. Undefined for an unknown
 * token and for a revoked invitation.
 */
export async function findInvitation(
	db: Database,
	token: string,
	now = Date.now()
): Promise<FoundInvitation | undefined> {
	const [row] = await db
		.select({
			id: invitations.id,
			accountId: invitations.accountId,
			email: invitations.email,
			expiresAt: invitations.expiresAt,
			acceptedAt: invitations.acceptedAt,
			revokedAt: invitations.revokedAt
		})
		.from(invitations)
		.where(eq(invitations.tokenHash, await hashToken(token)));
	if (!row || row.revokedAt) return undefined;
	const status: InvitationStatus = row.acceptedAt
		? 'accepted'
		: row.expiresAt.getTime() <= now
			? 'expired'
			: 'open';
	return { id: row.id, accountId: row.accountId, email: row.email, status };
}

export type AcceptInvitationResult =
	| { ok: true; userId: string; accountId: string }
	| { ok: false; reason: 'invalid' | 'expired' | 'accepted' | 'email-taken' };

/**
 * Registers the invitee into the inviting account as a manager and marks the invitation
 * accepted, in one batch. The address comes from the invitation, never from the form.
 */
export async function acceptInvitation(
	db: Database,
	token: string,
	input: { name: string; password: string },
	now = Date.now()
): Promise<AcceptInvitationResult> {
	const invitation = await findInvitation(db, token, now);
	if (!invitation) return { ok: false, reason: 'invalid' };
	if (invitation.status !== 'open') return { ok: false, reason: invitation.status };
	const [taken] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, invitation.email));
	if (taken) return { ok: false, reason: 'email-taken' };
	const userId = crypto.randomUUID();
	const name = input.name.trim();
	await runBatch(db, [
		db.insert(users).values({
			id: userId,
			accountId: invitation.accountId,
			email: invitation.email,
			passwordHash: await hashPassword(input.password),
			role: 'manager',
			name
		}),
		db
			.update(invitations)
			.set({ acceptedAt: new Date(now) })
			.where(eq(invitations.id, invitation.id)),
		auditEntry(
			db,
			{ accountId: invitation.accountId, userId },
			'user',
			userId,
			'create',
			`${name} hat die Einladung angenommen und ist jetzt ${userRoleLabels.manager}`
		)
	]);
	return { ok: true, userId, accountId: invitation.accountId };
}

/**
 * Removes a manager of the account with their sessions, resets and address changes. Neither
 * oneself nor an owner can be removed, so the account always keeps its owner. References to the
 * user in other tables are set to null by the schema; the audit log keeps the name in its
 * summaries.
 */
export async function removeUser(
	db: Database,
	context: AuditContext,
	userId: string
): Promise<'removed' | 'missing' | 'self' | 'owner'> {
	if (userId === context.userId) return 'self';
	const [user] = await db
		.select({ id: users.id, email: users.email, name: users.name, role: users.role })
		.from(users)
		.where(
			and(
				eq(users.accountId, context.accountId),
				eq(users.id, userId),
				ne(users.id, context.userId ?? '')
			)
		);
	if (!user) return 'missing';
	if (user.role === 'owner') return 'owner';
	await runBatch(db, [
		db.delete(sessions).where(eq(sessions.userId, user.id)),
		db.delete(passwordResets).where(eq(passwordResets.userId, user.id)),
		db.delete(emailChanges).where(eq(emailChanges.userId, user.id)),
		db.delete(users).where(and(eq(users.accountId, context.accountId), eq(users.id, user.id))),
		auditEntry(
			db,
			context,
			'user',
			user.id,
			'delete',
			`${userRoleLabels[user.role]} ${user.name || user.email} entfernt`
		)
	]);
	return 'removed';
}

const INVITER_MAX_LENGTH = 60;

/**
 * The inviter's name as the mail may print it: one line, at most 60 characters and nothing that
 * a mail program would turn into a link, because the name is whatever the inviter typed into
 * their profile. 'Jemand' when nothing is left.
 */
export function inviterName(name: string | null): string {
	const cleaned = (name ?? '')
		.replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, ' ')
		.replace(/\S*[\p{L}\p{N}-]\.\p{L}{2,}\S*/gu, ' ')
		.replace(/[@:/\\]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, INVITER_MAX_LENGTH)
		.trim();
	return cleaned || 'Jemand';
}

/** The mail with the invitation link; `link` is the absolute URL of /einladung/<token>. */
export function invitationMail(to: string, link: string, inviter: string | null): Mail {
	return {
		to,
		subject: 'Einladung zu mietkartei',
		text:
			'Hallo,\n\n' +
			`${inviterName(inviter)} lädt dich ein, in mietkartei als ${userRoleLabels.manager} ` +
			'mitzuarbeiten. Mit diesem Link legst du dein Zugangskonto an; er gilt sieben Tage:\n\n' +
			`${link}\n\n` +
			'Wenn du die Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.\n'
	};
}
