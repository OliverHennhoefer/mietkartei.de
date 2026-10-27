import { and, asc, eq, like, lt } from 'drizzle-orm';
import { deleteAccount } from './accounts';
import { createSession } from './auth';
import type { Database } from './db';
import { accounts, outbox, users } from './db/schema';
import { createDemoData } from './demo';
import type { Storage } from './storage';

// The public demo (DEMO=true, demo.mietkartei.de): every visitor gets an account of their own
// with the demo data, signed in without a password. The accounts are thrown away after a day.
// Their owners have addresses under a reserved domain, which nobody can confirm a change of,
// so only demo accounts are ever deleted here, even on an instance that set DEMO by mistake.

export const DEMO_LIFETIME = 24 * 60 * 60 * 1000;
const DEMO_EMAIL_DOMAIN = '@demo.invalid';
/** Expired accounts deleted per new demo, so the work stays small after a busy day. */
const EXPIRED_PER_START = 5;

/** Creates a demo account with the demo data and returns the session for its owner. */
export async function startDemo(db: Database, options?: { storage?: Storage }) {
	// Clearing out yesterday's demos is not the visitor's business: on Workers it runs after the
	// response.
	const cleanup = deleteExpiredDemoAccounts(db, Date.now(), options).catch((error: unknown) =>
		console.error('[demo] Deleting expired demo accounts failed:', error)
	);
	if (__DEPLOY_TARGET__ === 'cloudflare') {
		const { waitUntil } = await import('cloudflare:workers');
		waitUntil(cleanup);
	} else await cleanup;
	const [account] = await db
		.insert(accounts)
		.values({
			name: 'Demo',
			// The sender of the demo's letters and statements.
			landlordName: 'Katrin Hoffmann',
			street: 'Kastanienallee 25',
			postalCode: '10435',
			city: 'Berlin',
			iban: 'DE63100500006600099110',
			bankName: 'Berliner Sparkasse'
		})
		.returning({ id: accounts.id });
	const [user] = await db
		.insert(users)
		.values({
			accountId: account.id,
			email: `demo-${crypto.randomUUID()}${DEMO_EMAIL_DOMAIN}`,
			// No hash at all, so no password matches: the demo signs in through the session alone.
			passwordHash: '!',
			name: 'Demo'
		})
		.returning({ id: users.id });
	await createDemoData(db, { accountId: account.id, userId: user.id }, options);
	return createSession(db, user.id);
}

/**
 * Deletes the oldest demo accounts created before the lifetime and returns how many. The mails
 * of the demo (invitations a visitor sent) are only stored, and go after the same lifetime.
 */
export async function deleteExpiredDemoAccounts(
	db: Database,
	now: number,
	options?: { storage?: Storage }
): Promise<number> {
	const expired = await db
		.select({ id: accounts.id })
		.from(accounts)
		.innerJoin(users, eq(users.accountId, accounts.id))
		.where(
			and(
				eq(users.role, 'owner'),
				like(users.email, `demo-%${DEMO_EMAIL_DOMAIN}`),
				lt(accounts.createdAt, new Date(now - DEMO_LIFETIME))
			)
		)
		.orderBy(asc(accounts.createdAt))
		.limit(EXPIRED_PER_START);
	for (const { id } of expired) await deleteAccount(db, id, options);
	await db.delete(outbox).where(lt(outbox.createdAt, new Date(now - DEMO_LIFETIME)));
	return expired.length;
}
