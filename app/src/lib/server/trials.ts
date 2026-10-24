import { eq, lt } from 'drizzle-orm';
import { TRIAL_FINGERPRINT_KEY } from '$app/env/private';
import { billingEnabled } from './billing';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { trialClaims } from './db/schema';

// One free trial per address. A new account stores a keyed fingerprint of its owner's address;
// the row outlives the account, so a deleted account's address registers again without a trial.
// Only the HMAC is stored, never the address, and the key keeps it from being guessed by hashing
// address lists. Rows older than TRIAL_CLAIM_RETENTION_MS are deleted.

const DAY_MS = 24 * 60 * 60 * 1000;
export const TRIAL_CLAIM_RETENTION_MS = 2 * 365 * DAY_MS;

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * The address the way a mailbox receives it, so variants of one mailbox count as one: lower case,
 * no `+tag`, and at Gmail no dots and googlemail.com as gmail.com.
 */
export function canonicalEmail(email: string): string {
	const address = email.trim().toLowerCase();
	const at = address.lastIndexOf('@');
	if (at < 1) return address;
	let local = address.slice(0, at).split('+')[0];
	let domain = address.slice(at + 1);
	if (GMAIL_DOMAINS.has(domain)) {
		local = local.replaceAll('.', '');
		domain = 'gmail.com';
	}
	return `${local}@${domain}`;
}

const encoder = new TextEncoder();

/** HMAC-SHA-256 of the canonical address under `key`, hex. */
export async function trialFingerprint(email: string, key: string): Promise<string> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(key),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign(
		'HMAC',
		cryptoKey,
		encoder.encode(canonicalEmail(email))
	);
	return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
		''
	);
}

/**
 * Claims the trial of a new account's address. Returns the trial end to store on the account:
 * `now` when the address had a trial before (the account starts without one), undefined when
 * this is its first (the default 30 days apply) or billing or the key is not configured.
 */
export async function claimTrial(
	db: Database,
	email: string,
	now = new Date()
): Promise<Date | undefined> {
	if (!billingEnabled() || !TRIAL_FINGERPRINT_KEY) return undefined;
	const id = await trialFingerprint(email, TRIAL_FINGERPRINT_KEY);
	const [claimed] = await db
		.select({ id: trialClaims.id })
		.from(trialClaims)
		.where(eq(trialClaims.id, id));
	if (claimed) return now;
	await runBatch(db, [
		db
			.delete(trialClaims)
			.where(lt(trialClaims.createdAt, new Date(now.getTime() - TRIAL_CLAIM_RETENTION_MS))),
		db.insert(trialClaims).values({ id, createdAt: now }).onConflictDoNothing()
	]);
	return undefined;
}
