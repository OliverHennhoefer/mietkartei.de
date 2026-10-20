import { error, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { BILLING_REQUIRED, STRIPE_PRICE_ID, STRIPE_SECRET_KEY } from '$app/env/private';
import { formatDate, type IsoDate } from '../dates';
import { subscriptionStatusLabels } from '../labels';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { accounts, stripeEvents, type SubscriptionStatus } from './db/schema';

// Subscriptions through Stripe. The hosted variant configures the keys; self-hosting leaves them
// unset, and then nothing about billing is shown. Every account starts with a 30-day trial; with
// BILLING_REQUIRED an account whose trial ended without a subscription may only read.

export function billingEnabled(): boolean {
	return Boolean(STRIPE_SECRET_KEY && STRIPE_PRICE_ID);
}

export const TRIAL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const berlinDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' });

/** The calendar day of a timestamp in Germany, for dates shown to the landlord. */
export function dayOf(date: Date): IsoDate {
	return berlinDate.format(date);
}

/** The columns of an account the billing rules read. */
export type BillingAccount = {
	subscriptionStatus: SubscriptionStatus;
	trialEndsAt: Date | null;
	currentPeriodEnd: Date | null;
	createdAt: Date;
};

export type BillingState = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

/** When the free trial ends: the stored date, else 30 days after the account was created. */
export function trialEnd(account: BillingAccount): Date {
	return account.trialEndsAt ?? new Date(account.createdAt.getTime() + TRIAL_DAYS * DAY_MS);
}

/** Whole days of trial left at `now`, rounded up; 0 once it has ended. */
export function trialDaysLeft(account: BillingAccount, now: Date): number {
	const left = trialEnd(account).getTime() - now.getTime();
	return left > 0 ? Math.ceil(left / DAY_MS) : 0;
}

/**
 * What the account may do at `now`: `trialing` (free trial or a Stripe trial), `active`,
 * `past_due` (a payment failed, Stripe retries), `canceled` (the subscription ended) or
 * `expired` (the trial ended and no subscription was ever started).
 */
export function billingState(account: BillingAccount, now: Date): BillingState {
	switch (account.subscriptionStatus) {
		case 'active':
			return 'active';
		case 'past_due':
			return 'past_due';
		case 'canceled':
			return 'canceled';
		case 'trialing':
			return 'trialing';
		default:
			return now < trialEnd(account) ? 'trialing' : 'expired';
	}
}

/** The states in which a read-only instance refuses writes. */
export function isReadOnly(state: BillingState): boolean {
	return state === 'expired' || state === 'canceled';
}

export type BillingNotice = { text: string; href: string; tone: 'info' | 'warning' | 'danger' };

/** The notice for an account, given the state and whether writes are refused after the trial. */
export function noticeFor(
	account: BillingAccount,
	now: Date,
	required: boolean
): BillingNotice | undefined {
	const href = '/abo';
	const state = billingState(account, now);
	switch (state) {
		case 'active':
			return undefined;
		case 'trialing': {
			// A Stripe trial already belongs to a subscription; only the app's own trial is announced.
			if (account.subscriptionStatus === 'trialing') return undefined;
			const end = trialEnd(account);
			const tone = trialDaysLeft(account, now) <= 7 ? 'warning' : 'info';
			return { text: `Deine Testphase endet am ${formatDate(dayOf(end))}.`, href, tone };
		}
		case 'past_due':
			return { text: 'Die letzte Zahlung ist fehlgeschlagen.', href, tone: 'warning' };
		case 'canceled':
			return required
				? { text: 'Dein Abo ist beendet. Du kannst nur noch lesen.', href, tone: 'danger' }
				: { text: 'Dein Abo ist beendet.', href, tone: 'info' };
		case 'expired':
			return required
				? {
						text: 'Deine Testphase ist abgelaufen. Du kannst nur noch lesen.',
						href,
						tone: 'danger'
					}
				: { text: 'Deine Testphase ist abgelaufen.', href, tone: 'info' };
	}
}

/** Paths that still accept a POST while the account is read-only. */
const writablePaths = new Set(['/abo', '/abmelden', '/webhooks/stripe']);

/** Whether a request has to be refused: a POST outside the billing pages of a read-only account. */
export function refusesWrite(
	state: BillingState,
	method: string,
	pathname: string,
	required: boolean
): boolean {
	if (!required || !isReadOnly(state)) return false;
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
	return !writablePaths.has(pathname.replace(/\/$/, '') || '/');
}

export const READ_ONLY_MESSAGE = 'Dein Konto ist nur noch lesbar, bis ein Abo abgeschlossen ist.';

/** The billing columns of the account; undefined when it does not exist. */
export async function getBillingAccount(db: Database, accountId: string) {
	const [account] = await db
		.select({
			id: accounts.id,
			subscriptionStatus: accounts.subscriptionStatus,
			trialEndsAt: accounts.trialEndsAt,
			currentPeriodEnd: accounts.currentPeriodEnd,
			stripeCustomerId: accounts.stripeCustomerId,
			stripeSubscriptionId: accounts.stripeSubscriptionId,
			createdAt: accounts.createdAt
		})
		.from(accounts)
		.where(eq(accounts.id, accountId));
	return account;
}

/**
 * Called by the hook for every signed-in request. With BILLING_REQUIRED, accounts whose trial has
 * ended without a subscription may only read: writes outside the billing pages are refused.
 * Self-hosted instances (no Stripe keys) never get here.
 */
export async function enforceBilling(event: RequestEvent): Promise<void> {
	if (!billingEnabled() || !BILLING_REQUIRED || !event.locals.user) return;
	const method = event.request.method;
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
	const account = await getBillingAccount(event.locals.db, event.locals.user.accountId);
	if (!account) return;
	const state = billingState(account, new Date());
	if (refusesWrite(state, method, event.url.pathname, true)) error(403, READ_ONLY_MESSAGE);
}

/**
 * A line shown above every page while the trial runs out or the account is read-only, with a
 * link to the subscription page. Nothing while billing is off or the subscription is active.
 */
export async function billingNotice(locals: App.Locals): Promise<BillingNotice | undefined> {
	if (!billingEnabled() || !locals.user) return undefined;
	const account = await getBillingAccount(locals.db, locals.user.accountId);
	if (!account) return undefined;
	return noticeFor(account, new Date(), BILLING_REQUIRED);
}

/** Remembers the Stripe customer of the account, so Checkout and the portal reuse it. */
export async function setStripeCustomer(
	db: Database,
	context: AuditContext,
	customerId: string
): Promise<void> {
	await runBatch(db, [
		db
			.update(accounts)
			.set({ stripeCustomerId: customerId })
			.where(eq(accounts.id, context.accountId)),
		auditEntry(db, context, 'account', context.accountId, 'update', 'Stripe-Kunde angelegt')
	]);
}

/** Stripe's subscription statuses mapped onto the account column. */
export function mapSubscriptionStatus(status: string): SubscriptionStatus {
	switch (status) {
		case 'trialing':
			return 'trialing';
		case 'active':
			return 'active';
		case 'past_due':
			return 'past_due';
		case 'canceled':
		case 'unpaid':
		case 'incomplete_expired':
			return 'canceled';
		default:
			// `incomplete` and `paused`: nothing is paid yet, so the account keeps what it had.
			return 'none';
	}
}

export type SubscriptionUpdate = {
	customerId: string;
	subscriptionId: string;
	status: string;
	currentPeriodEnd: Date | null;
};

/**
 * Applies a subscription change from a webhook to the account of the Stripe customer, together
 * with the event row that marks the delivery as processed, in one batch. The audit entry has no
 * user. Returns the account id, or undefined when no account has this customer.
 */
export async function applySubscriptionUpdate(
	db: Database,
	event: { id: string; type: string },
	update: SubscriptionUpdate
): Promise<string | undefined> {
	const [account] = await db
		.select({ id: accounts.id, subscriptionStatus: accounts.subscriptionStatus })
		.from(accounts)
		.where(eq(accounts.stripeCustomerId, update.customerId));
	if (!account) return undefined;

	const mapped = mapSubscriptionStatus(update.status);
	const status = mapped === 'none' ? account.subscriptionStatus : mapped;
	const until = update.currentPeriodEnd
		? ` (bis ${formatDate(dayOf(update.currentPeriodEnd))})`
		: '';
	const context: AuditContext = { accountId: account.id, userId: null };
	await runBatch(db, [
		db.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing(),
		db
			.update(accounts)
			.set({
				stripeSubscriptionId: update.subscriptionId,
				subscriptionStatus: status,
				currentPeriodEnd: update.currentPeriodEnd
			})
			.where(eq(accounts.id, account.id)),
		auditEntry(
			db,
			context,
			'account',
			account.id,
			'update',
			`Abo-Status von Stripe übernommen: ${subscriptionStatusLabels[status]}${until}`
		)
	]);
	return account.id;
}

/** Whether a webhook event was already processed. */
export async function stripeEventSeen(db: Database, eventId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: stripeEvents.id })
		.from(stripeEvents)
		.where(eq(stripeEvents.id, eventId));
	return Boolean(row);
}

/** Records an event that needs no other change. */
export async function recordStripeEvent(db: Database, id: string, type: string): Promise<void> {
	await db.insert(stripeEvents).values({ id, type }).onConflictDoNothing();
}
