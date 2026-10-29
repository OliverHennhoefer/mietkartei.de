import { and, asc, count, eq, gte, like, lt } from 'drizzle-orm';
import { deleteAccount } from './accounts';
import { createSession } from './auth';
import { runBatch } from './db/batch';
import { today } from '../dates';
import { weekStart } from './deadline-mails';
import type { Database } from './db';
import { accounts, outbox, users } from './db/schema';
import { createDemoData } from './demo';
import { createReferenceData } from './reference-demo';
import type { ReferenceCase } from '../domain/reference-cases';
import type { Storage } from './storage';

// The public demo (DEMO=true, demo.mietkartei.de): every visitor gets an account of their own
// with the demo data, signed in without a password. The accounts are thrown away after a day.
// Their owners have addresses under a reserved domain, which nobody can confirm a change of,
// so only demo accounts are ever deleted here, even on an instance that set DEMO by mistake.

export const DEMO_LIFETIME = 24 * 60 * 60 * 1000;
const DEMO_EMAIL_DOMAIN = '@demo.invalid';
/** Expired accounts deleted per new demo, so the work stays small after a busy day. */
const EXPIRED_PER_START = 5;
/**
 * New demos per hour across all visitors. Each one writes some 3,000 rows (16,000 row writes with
 * the indexes) and 2.4 MB, so a script with many addresses could otherwise run up the bill and
 * fill the database; real visitors stay far below it.
 */
export const DEMO_STARTS_PER_HOUR = 50;
const HOUR = 60 * 60 * 1000;

/**
 * Creates a demo account with the demo data, or with one Rechenbeispiel of the website only, and
 * returns the session for its owner and the page to open first, or null when the demos of the
 * last hour reached DEMO_STARTS_PER_HOUR.
 */
export async function startDemo(
	db: Database,
	options?: { storage?: Storage; example?: ReferenceCase }
) {
	// The account and its owner come first, in one batch, and the count after them: parallel
	// starts each see their own account and those before it, so no more than the limit get through.
	const accountId = crypto.randomUUID();
	const userId = crypto.randomUUID();
	await runBatch(db, [
		db.insert(accounts).values({
			id: accountId,
			name: 'Demo',
			// The sender of the demo's letters and statements.
			landlordName: options?.example ? 'Eva Beispiel' : 'Katrin Hoffmann',
			street: 'Kastanienallee 25',
			postalCode: '10435',
			city: 'Berlin',
			iban: 'DE63100500006600099110',
			bankName: 'Berliner Sparkasse'
		}),
		db.insert(users).values({
			id: userId,
			accountId,
			email: `demo-${crypto.randomUUID()}${DEMO_EMAIL_DOMAIN}`,
			// No hash at all, so no password matches: the demo signs in through the session alone.
			passwordHash: '!',
			name: 'Demo',
			// The weekly Fristenübersicht is on, as a landlord would have it; the demo sends none.
			deadlineMailOrigin: 'https://demo.mietkartei.de',
			deadlineMailSentOn: weekStart(today())
		})
	]);
	if ((await countDemoStarts(db, Date.now() - HOUR)) > DEMO_STARTS_PER_HOUR) {
		await deleteAccount(db, accountId, options);
		return null;
	}
	// Clearing out yesterday's demos is not the visitor's business: on Workers it runs after the
	// response.
	const cleanup = deleteExpiredDemoAccounts(db, Date.now(), options);
	if (__DEPLOY_TARGET__ === 'cloudflare') {
		const { waitUntil } = await import('cloudflare:workers');
		waitUntil(cleanup);
	} else await cleanup;
	let home = '/';
	if (options?.example) {
		const statementId = await createReferenceData(db, { accountId, userId }, options.example);
		home = `/betriebskosten/abrechnungen/${statementId}`;
	} else await createDemoData(db, { accountId, userId }, options);
	return { ...(await createSession(db, userId)), home };
}

/** The demo accounts created since the time. */
async function countDemoStarts(db: Database, since: number): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(accounts)
		.innerJoin(users, eq(users.accountId, accounts.id))
		.where(
			and(
				eq(users.role, 'owner'),
				like(users.email, `demo-%${DEMO_EMAIL_DOMAIN}`),
				gte(accounts.createdAt, new Date(since))
			)
		);
	return row.count;
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
