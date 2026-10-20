import { and, asc, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { userRoleLabels } from '../labels';
import { auditEntry, type AuditContext } from './audit';
import { generateToken, hashPassword, hashToken, normalizeEmail } from './auth';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { invitations, passwordResets, sessions, users, type UserRole } from './db/schema';
import type { Mail } from './mail';

// Invitations (Mitverwalter einladen): the owner invites an address with a role; the mail holds
// a random token, the database only its SHA-256. The invitee registers through the link into the
// inviting account, whatever OPEN_REGISTRATION says. Links are valid for seven days.

export const INVITATION_LIFETIME = 7 * 24 * 60 * 60 * 1000;

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
		.orderBy(asc(users.role), asc(users.name), asc(users.email));
}

export type PendingInvitation = {
	id: string;
	email: string;
	role: UserRole;
	expiresAt: Date;
	createdAt: Date;
};

/** Invitations of the account that are neither accepted nor expired, newest first. */
export async function listPendingInvitations(
	db: Database,
	accountId: string,
	now = Date.now()
): Promise<PendingInvitation[]> {
	return db
		.select({
			id: invitations.id,
			email: invitations.email,
			role: invitations.role,
			expiresAt: invitations.expiresAt,
			createdAt: invitations.createdAt
		})
		.from(invitations)
		.where(
			and(
				eq(invitations.accountId, accountId),
				isNull(invitations.acceptedAt),
				gt(invitations.expiresAt, new Date(now))
			)
		)
		.orderBy(desc(invitations.createdAt));
}

export type InvitationInput = { email: string; role: UserRole };

export type CreateInvitationResult =
	| { ok: true; id: string; email: string; token: string }
	| { ok: false; reason: 'email-taken' | 'already-invited' };

/**
 * Invites an address. Refused when a user already has the address (in any account: addresses
 * are unique) or when the account has an open invitation for it; the owner revokes that one
 * first. Returns the token for the mail, which is never stored.
 */
export async function createInvitation(
	db: Database,
	context: AuditContext,
	input: InvitationInput,
	now = Date.now()
): Promise<CreateInvitationResult> {
	const email = normalizeEmail(input.email);
	const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
	if (taken) return { ok: false, reason: 'email-taken' };
	const pending = await listPendingInvitations(db, context.accountId, now);
	if (pending.some((invitation) => invitation.email === email)) {
		return { ok: false, reason: 'already-invited' };
	}
	const id = crypto.randomUUID();
	const token = generateToken();
	await runBatch(db, [
		db.insert(invitations).values({
			id,
			accountId: context.accountId,
			email,
			role: input.role,
			tokenHash: await hashToken(token),
			expiresAt: new Date(now + INVITATION_LIFETIME),
			invitedBy: context.userId
		}),
		auditEntry(
			db,
			context,
			'invitation',
			id,
			'invite',
			`${email} als ${userRoleLabels[input.role]} eingeladen`
		)
	]);
	return { ok: true, id, email, token };
}

/** Deletes an open invitation of the account. False when there is none. */
export async function revokeInvitation(
	db: Database,
	context: AuditContext,
	invitationId: string
): Promise<boolean> {
	const [invitation] = await db
		.select({ id: invitations.id, email: invitations.email })
		.from(invitations)
		.where(
			and(
				eq(invitations.accountId, context.accountId),
				eq(invitations.id, invitationId),
				isNull(invitations.acceptedAt)
			)
		);
	if (!invitation) return false;
	await runBatch(db, [
		db.delete(invitations).where(eq(invitations.id, invitation.id)),
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
	role: UserRole;
	status: InvitationStatus;
};

/** The invitation behind a token, with whether it can still be used. Undefined for an unknown token. */
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
			role: invitations.role,
			expiresAt: invitations.expiresAt,
			acceptedAt: invitations.acceptedAt
		})
		.from(invitations)
		.where(eq(invitations.tokenHash, await hashToken(token)));
	if (!row) return undefined;
	const status: InvitationStatus = row.acceptedAt
		? 'accepted'
		: row.expiresAt.getTime() <= now
			? 'expired'
			: 'open';
	return { id: row.id, accountId: row.accountId, email: row.email, role: row.role, status };
}

export type AcceptInvitationResult =
	| { ok: true; userId: string; accountId: string }
	| { ok: false; reason: 'invalid' | 'expired' | 'accepted' | 'email-taken' };

/**
 * Registers the invitee into the inviting account with the invited role and marks the
 * invitation accepted, in one batch. The address comes from the invitation, never from the form.
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
			role: invitation.role,
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
			`${name} hat die Einladung angenommen und ist jetzt ${userRoleLabels[invitation.role]}`
		)
	]);
	return { ok: true, userId, accountId: invitation.accountId };
}

/**
 * Removes another user of the account with their sessions and resets. One cannot remove
 * oneself, so the account always keeps the owner who is acting. References to the user in
 * other tables are set to null by the schema; the audit log keeps the name in its summaries.
 */
export async function removeUser(
	db: Database,
	context: AuditContext,
	userId: string
): Promise<'removed' | 'missing' | 'self'> {
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
	await runBatch(db, [
		db.delete(sessions).where(eq(sessions.userId, user.id)),
		db.delete(passwordResets).where(eq(passwordResets.userId, user.id)),
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

/** The mail with the invitation link; `link` is the absolute URL of /einladung/<token>. */
export function invitationMail(
	to: string,
	link: string,
	details: { inviter: string; role: UserRole }
): Mail {
	return {
		to,
		subject: 'Einladung zu mietkartei',
		text:
			'Hallo,\n\n' +
			`${details.inviter} lädt dich ein, in mietkartei als ${userRoleLabels[details.role]} ` +
			'mitzuarbeiten. Mit diesem Link legst du dein Zugangskonto an; er gilt sieben Tage:\n\n' +
			`${link}\n\n` +
			'Wenn du die Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.\n'
	};
}
