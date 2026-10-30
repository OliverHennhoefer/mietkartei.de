import { error, type RequestEvent } from '@sveltejs/kit';
import { and, eq, isNull, lt } from 'drizzle-orm';
import {
	BILLING_REQUIRED,
	FREE_ACCOUNT_EMAILS,
	STRIPE_PRICE_ID,
	STRIPE_SECRET_KEY,
	STRIPE_YEARLY_PRICE_ID
} from '$app/env/private';
import { dayOf, formatDate } from '../dates';
import { subscriptionStatusLabels } from '../labels';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { accounts, stripeEvents, users, type SubscriptionStatus } from './db/schema';
import { cancelSubscription, getSubscription, listSubscriptions, StripeError } from './stripe';

// Subscriptions through Stripe. The hosted variant configures the keys; self-hosting leaves them
// unset, and then nothing about billing is shown. Every account starts with a 30-day trial; with
// BILLING_REQUIRED an account whose trial ended without a subscription may only read. Accounts
// whose owner is in FREE_ACCOUNT_EMAILS (family, friends) never pay.

export function billingEnabled(): boolean {
	return Boolean(STRIPE_SECRET_KEY && STRIPE_PRICE_ID);
}

export type Plan = 'monthly' | 'yearly';

/** The Stripe price of a plan; undefined for a yearly plan the instance does not offer. */
export function priceFor(plan: Plan): string | undefined {
	return plan === 'yearly' ? STRIPE_YEARLY_PRICE_ID || undefined : STRIPE_PRICE_ID;
}

const TRIAL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The columns of an account the billing rules read. */
export type BillingAccount = {
	subscriptionStatus: SubscriptionStatus;
	trialEndsAt: Date | null;
	currentPeriodEnd: Date | null;
	createdAt: Date;
	/** The owner's address is in FREE_ACCOUNT_EMAILS. */
	free?: boolean;
};

export type BillingState = 'free' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

/** Whether an owner's address is in FREE_ACCOUNT_EMAILS. */
export function isFreeEmail(email: string | null | undefined, list = FREE_ACCOUNT_EMAILS): boolean {
	if (!email || !list) return false;
	const address = email.trim().toLowerCase();
	return list.split(',').some((entry) => entry.trim().toLowerCase() === address);
}

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
 * What the account may do at `now`: `free` (the owner never pays, whatever Stripe says), `trialing` (free trial or a Stripe trial), `active`,
 * `past_due` (a payment failed, Stripe retries), `canceled` (the subscription ended) or
 * `expired` (the trial ended and no subscription was ever started).
 */
export function billingState(account: BillingAccount, now: Date): BillingState {
	if (account.free) return 'free';
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
function isReadOnly(state: BillingState): boolean {
	return state === 'expired' || state === 'canceled';
}

/** `highlight` marks the trial notice with the brand's neon block, the only one that is temporary. */
export type BillingNotice = {
	text: string;
	href: string;
	tone: 'info' | 'warning' | 'danger';
	highlight?: true;
};

/** The notice for an account, given the state and whether writes are refused after the trial. */
export function noticeFor(
	account: BillingAccount,
	now: Date,
	required: boolean
): BillingNotice | undefined {
	const href = '/abo';
	const state = billingState(account, now);
	switch (state) {
		case 'free':
		case 'active':
			return undefined;
		case 'trialing': {
			// A Stripe trial already belongs to a subscription; only the app's own trial is announced.
			if (account.subscriptionStatus === 'trialing') return undefined;
			const end = trialEnd(account);
			const tone = trialDaysLeft(account, now) <= 7 ? 'warning' : 'info';
			return {
				text: `Deine Testphase endet am ${formatDate(dayOf(end))}.`,
				href,
				tone,
				highlight: true
			};
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

/** Paths that still accept every POST while the account is read-only. */
const writablePaths = new Set(['/abo', '/abmelden', '/api/webhooks/stripe']);

/**
 * The pages of reset and address confirmation links, which secure the sign-in as well, and of
 * registration links, which create a new account that has nothing to do with the signed-in one.
 */
const writablePrefixes = ['/passwort-zuruecksetzen/', '/e-mail-bestaetigen/', '/registrieren/'];

/**
 * Form actions that still work while the account is read-only: leaving the service (deleting or
 * leaving the account), securing the sign-in (name, email, password), withdrawing an API key's
 * access and turning the Fristen mail off (or on: it only reads) must never depend on paying.
 */
const writableActions = new Map([
	['/einstellungen/konto', new Set(['delete', 'leave'])],
	['/einstellungen/profil', new Set(['profile', 'password'])],
	['/einstellungen/ki-assistenten', new Set(['revoke'])],
	['/einstellungen/kalender', new Set(['mail'])]
]);

/** The form action a POST goes to, the way SvelteKit reads it: `?/delete` → `delete`. */
export function actionName(searchParams: URLSearchParams): string {
	for (const key of searchParams.keys()) {
		if (key.startsWith('/')) return key.slice(1);
	}
	return 'default';
}

/**
 * Whether a request has to be refused: a POST of a read-only account outside the billing pages
 * and the actions in `writableActions`.
 */
export function refusesWrite(
	state: BillingState,
	method: string,
	pathname: string,
	required: boolean,
	action = 'default'
): boolean {
	if (!required || !isReadOnly(state)) return false;
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
	const path = pathname.replace(/\/$/, '') || '/';
	if (writablePaths.has(path)) return false;
	if (writablePrefixes.some((prefix) => path.startsWith(prefix))) return false;
	return !writableActions.get(path)?.has(action);
}

const READ_ONLY_MESSAGE = 'Dein Konto ist nur noch lesbar, bis ein Abo abgeschlossen ist.';

/**
 * The billing columns of the account, and whether its owner's address makes it free; undefined
 * when it does not exist.
 */
export async function getBillingAccount(db: Database, accountId: string) {
	const [row] = await db
		.select({
			id: accounts.id,
			subscriptionStatus: accounts.subscriptionStatus,
			trialEndsAt: accounts.trialEndsAt,
			currentPeriodEnd: accounts.currentPeriodEnd,
			stripeCustomerId: accounts.stripeCustomerId,
			stripeSubscriptionId: accounts.stripeSubscriptionId,
			stripeCheckoutSessionId: accounts.stripeCheckoutSessionId,
			stripePriceId: accounts.stripePriceId,
			createdAt: accounts.createdAt,
			ownerEmail: users.email
		})
		.from(accounts)
		.leftJoin(users, and(eq(users.accountId, accounts.id), eq(users.role, 'owner')))
		.where(eq(accounts.id, accountId));
	if (!row) return undefined;
	const { ownerEmail, ...account } = row;
	return { ...account, free: isFreeEmail(ownerEmail) };
}

/**
 * Stores a new Checkout session for the account, but only while the stored one is still
 * `previous`: of two Checkouts opened at the same time only one is kept. False when another
 * request stored its session first; that request's session is then the one to use.
 */
export async function replaceCheckoutSession(
	db: Database,
	accountId: string,
	previous: string | null,
	next: string
): Promise<boolean> {
	const stored = previous
		? eq(accounts.stripeCheckoutSessionId, previous)
		: isNull(accounts.stripeCheckoutSessionId);
	const rows = await db
		.update(accounts)
		.set({ stripeCheckoutSessionId: next })
		.where(and(eq(accounts.id, accountId), stored))
		.returning({ id: accounts.id });
	return rows.length > 0;
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
	const action = actionName(event.url.searchParams);
	if (refusesWrite(state, method, event.url.pathname, true, action)) error(403, READ_ONLY_MESSAGE);
}

/**
 * Whether the account may only read: the API's counterpart to enforceBilling, which looks at the
 * page and form action instead. False while billing is off or not required.
 */
export async function apiReadOnly(db: Database, accountId: string): Promise<boolean> {
	if (!billingEnabled() || !BILLING_REQUIRED) return false;
	const account = await getBillingAccount(db, accountId);
	return Boolean(account && isReadOnly(billingState(account, new Date())));
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

/**
 * Remembers the Stripe customer of the account, so Checkout and the portal reuse it. Only the
 * first customer is stored: of two simultaneous first checkouts, the later one gets the customer
 * the earlier one stored, so both open their session for it. Returns the stored customer.
 */
export async function setStripeCustomer(
	db: Database,
	context: AuditContext,
	customerId: string
): Promise<string | null> {
	const stored = await db
		.update(accounts)
		.set({ stripeCustomerId: customerId })
		.where(and(eq(accounts.id, context.accountId), isNull(accounts.stripeCustomerId)))
		.returning({ id: accounts.id });
	if (stored.length > 0) {
		await auditEntry(db, context, 'account', context.accountId, 'update', 'Stripe-Kunde angelegt');
		return customerId;
	}
	const [account] = await db
		.select({ customerId: accounts.stripeCustomerId })
		.from(accounts)
		.where(eq(accounts.id, context.accountId));
	return account?.customerId ?? null;
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
	/** The price the subscription bills; null when Stripe does not say. */
	priceId?: string | null;
	/** The Checkout session of a `checkout.session.completed` event; it is no longer pending. */
	checkoutSessionId?: string;
};

/** The mapped statuses of a subscription that bills the account. */
function bills(status: SubscriptionStatus): boolean {
	return status === 'trialing' || status === 'active' || status === 'past_due';
}

/** Whether the subscription still bills at Stripe; false when Stripe does not know it. */
async function stillBills(subscriptionId: string): Promise<boolean> {
	try {
		return bills(mapSubscriptionStatus((await getSubscription(subscriptionId)).status));
	} catch (cause) {
		if (cause instanceof StripeError && cause.status === 404) return false;
		throw cause;
	}
}

/**
 * Stripe retries a delivery for three days, so an event row only has to outlive that. Older rows
 * are deleted with every new one, which keeps the table at a few rows per account.
 */
const STRIPE_EVENT_RETENTION_MS = 30 * DAY_MS;

function insertStripeEvent(db: Database, id: string, type: string) {
	return db.insert(stripeEvents).values({ id, type }).onConflictDoNothing();
}

function pruneStripeEvents(db: Database) {
	const before = new Date(Date.now() - STRIPE_EVENT_RETENTION_MS);
	return db.delete(stripeEvents).where(lt(stripeEvents.receivedAt, before));
}

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
		.select({
			id: accounts.id,
			subscriptionStatus: accounts.subscriptionStatus,
			stripeSubscriptionId: accounts.stripeSubscriptionId,
			stripeCheckoutSessionId: accounts.stripeCheckoutSessionId
		})
		.from(accounts)
		.where(eq(accounts.stripeCustomerId, update.customerId));
	if (!account) return undefined;

	const context: AuditContext = { accountId: account.id, userId: null };
	// The pending Checkout is done once its completion arrives, whatever becomes of it below.
	const checkoutSessionId = update.checkoutSessionId;
	const clearCheckout =
		checkoutSessionId !== undefined && account.stripeCheckoutSessionId === checkoutSessionId
			? [
					db
						.update(accounts)
						.set({ stripeCheckoutSessionId: null })
						.where(
							and(
								eq(accounts.id, account.id),
								eq(accounts.stripeCheckoutSessionId, checkoutSessionId)
							)
						)
				]
			: [];
	const mapped = mapSubscriptionStatus(update.status);
	// A customer can have an older, ended subscription besides the running one. An event about
	// that one (a late retry, say) must not replace the running subscription, or the account
	// would turn read-only and its deletion would not cancel what still bills it.
	const stored = account.stripeSubscriptionId;
	const other = stored !== null && stored !== update.subscriptionId;
	if (other && subscriptionRuns(account) && (mapped === 'canceled' || mapped === 'none')) {
		await runBatch(db, [
			insertStripeEvent(db, event.id, event.type),
			pruneStripeEvents(db),
			...clearCheckout
		]);
		return account.id;
	}
	// A second subscription that bills while the stored one still does: two Checkouts completed
	// before the first webhook arrived. The account pays for one, so the newer one ends at once.
	// A failure throws, the webhook answers 500, and Stripe delivers the event again.
	if (other && subscriptionRuns(account) && bills(mapped) && (await stillBills(stored))) {
		if (!(await cancelOne(update.subscriptionId))) {
			throw new StripeError(
				502,
				`Could not cancel duplicate subscription ${update.subscriptionId}`
			);
		}
		await runBatch(db, [
			insertStripeEvent(db, event.id, event.type),
			pruneStripeEvents(db),
			...clearCheckout,
			auditEntry(
				db,
				context,
				'account',
				account.id,
				'update',
				`Zweites Abo bei Stripe sofort gekündigt: ${update.subscriptionId}`
			)
		]);
		return account.id;
	}
	const status = mapped === 'none' ? account.subscriptionStatus : mapped;
	const until = update.currentPeriodEnd
		? ` (bis ${formatDate(dayOf(update.currentPeriodEnd))})`
		: '';
	await runBatch(db, [
		insertStripeEvent(db, event.id, event.type),
		pruneStripeEvents(db),
		...clearCheckout,
		db
			.update(accounts)
			.set({
				stripeSubscriptionId: update.subscriptionId,
				subscriptionStatus: status,
				currentPeriodEnd: update.currentPeriodEnd,
				...(update.priceId ? { stripePriceId: update.priceId } : {})
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

/** Whether the account has a Stripe subscription that still bills it. */
export function subscriptionRuns(
	account:
		{ stripeSubscriptionId: string | null; subscriptionStatus: SubscriptionStatus } | undefined
): boolean {
	return Boolean(account?.stripeSubscriptionId) && account?.subscriptionStatus !== 'canceled';
}

/**
 * Ends the Stripe subscriptions of an account that is about to be deleted, so nobody keeps paying
 * for an account that no longer exists. Stripe is asked for every subscription of the customer,
 * not only the stored one: a Checkout whose webhook has not arrived yet bills as well. True when
 * nothing bills the account any more (billing off, no customer, nothing running, or canceled
 * now); false when Stripe could not cancel, and then the account must not be deleted.
 */
export async function cancelSubscriptionOf(db: Database, accountId: string): Promise<boolean> {
	if (!billingEnabled()) return true;
	const account = await getBillingAccount(db, accountId);
	if (!account?.stripeCustomerId) return true;
	let subscriptions;
	try {
		subscriptions = await listSubscriptions(account.stripeCustomerId);
	} catch {
		return false;
	}
	for (const subscription of subscriptions) {
		if (mapSubscriptionStatus(subscription.status) === 'canceled') continue;
		if (!(await cancelOne(subscription.id))) return false;
	}
	return true;
}

/** Cancels one subscription; true when it no longer bills, whoever ended it. */
async function cancelOne(subscriptionId: string): Promise<boolean> {
	try {
		await cancelSubscription(subscriptionId);
		return true;
	} catch (cause) {
		// Unknown to Stripe, or canceled in the meantime (Stripe refuses to cancel twice).
		if (cause instanceof StripeError && cause.status === 404) return true;
		try {
			return mapSubscriptionStatus((await getSubscription(subscriptionId)).status) === 'canceled';
		} catch {
			return false;
		}
	}
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
	await runBatch(db, [insertStripeEvent(db, id, type), pruneStripeEvents(db)]);
}
