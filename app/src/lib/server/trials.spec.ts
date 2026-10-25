import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerUser } from './auth';
import type { Database } from './db';
import { accounts, trialClaims, users } from './db/schema';
import { testDatabase } from './testing';
import { canonicalEmail, claimTrial, TRIAL_CLAIM_RETENTION_MS, trialFingerprint } from './trials';

const env = vi.hoisted(() => ({
	STRIPE_SECRET_KEY: 'sk_test_unit',
	STRIPE_PRICE_ID: 'price_unit',
	STRIPE_YEARLY_PRICE_ID: '',
	STRIPE_FOUNDER_PRICE_ID: '',
	FOUNDER_SPOTS: 100,
	TRIAL_FINGERPRINT_KEY: 'unit-key'
}));
vi.mock('$app/env/private', () => env);

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	Object.assign(env, { STRIPE_SECRET_KEY: 'sk_test_unit', TRIAL_FINGERPRINT_KEY: 'unit-key' });
});

describe('canonicalEmail', () => {
	it('counts variants of one mailbox as one address', () => {
		expect(canonicalEmail(' Max+mietkartei@Example.org ')).toBe('max@example.org');
		expect(canonicalEmail('m.a.x+1@googlemail.com')).toBe('max@gmail.com');
		expect(canonicalEmail('M.A.X@gmail.com')).toBe('max@gmail.com');
		// Dots matter outside Gmail.
		expect(canonicalEmail('m.a.x@example.org')).toBe('m.a.x@example.org');
	});
});

describe('trialFingerprint', () => {
	it('depends on the canonical address and the key, and hides the address', async () => {
		const one = await trialFingerprint('max@gmail.com', 'k');
		expect(one).toMatch(/^[0-9a-f]{64}$/);
		expect(await trialFingerprint('M.ax+x@googlemail.com', 'k')).toBe(one);
		expect(await trialFingerprint('max@gmail.com', 'other')).not.toBe(one);
		expect(await trialFingerprint('moritz@gmail.com', 'k')).not.toBe(one);
	});
});

describe('claimTrial', () => {
	const now = new Date('2026-11-01T12:00:00.000Z');

	it('grants the first trial of an address and none after it', async () => {
		expect(await claimTrial(db, 'max@example.org', now)).toBeUndefined();
		expect(await claimTrial(db, 'Max+neu@example.org', now)).toEqual(now);
		expect(await db.select().from(trialClaims)).toHaveLength(1);
	});

	it('forgets claims after the retention period', async () => {
		const old = new Date(now.getTime() - TRIAL_CLAIM_RETENTION_MS - 1);
		await claimTrial(db, 'max@example.org', old);
		expect(await claimTrial(db, 'moritz@example.org', now)).toBeUndefined();
		expect(await db.select().from(trialClaims)).toHaveLength(1);
		expect(await claimTrial(db, 'max@example.org', now)).toBeUndefined();
	});

	it('does nothing without billing or without a key', async () => {
		env.TRIAL_FINGERPRINT_KEY = '';
		expect(await claimTrial(db, 'max@example.org', now)).toBeUndefined();
		expect(await claimTrial(db, 'max@example.org', now)).toBeUndefined();
		env.TRIAL_FINGERPRINT_KEY = 'unit-key';
		env.STRIPE_SECRET_KEY = '';
		expect(await claimTrial(db, 'max@example.org', now)).toBeUndefined();
		expect(await db.select().from(trialClaims)).toHaveLength(0);
	});
});

describe('registration', () => {
	async function trialEndOf(email: string) {
		const [row] = await db
			.select({ trialEndsAt: accounts.trialEndsAt })
			.from(users)
			.innerJoin(accounts, eq(accounts.id, users.accountId))
			.where(eq(users.email, email));
		return row.trialEndsAt;
	}

	it('starts no second trial after the account was deleted', async () => {
		const first = await registerUser(db, 'max@example.org', 'richtig-langes-passwort');
		expect(first.ok).toBe(true);
		expect(await trialEndOf('max@example.org')).toBeNull();

		const [user] = await db.select().from(users).where(eq(users.email, 'max@example.org'));
		await db.delete(accounts).where(eq(accounts.id, user.accountId));

		const again = await registerUser(db, 'max+neu@example.org', 'richtig-langes-passwort');
		expect(again.ok).toBe(true);
		const end = await trialEndOf('max+neu@example.org');
		expect(end).not.toBeNull();
		expect(end!.getTime()).toBeLessThanOrEqual(Date.now());
	});
});
