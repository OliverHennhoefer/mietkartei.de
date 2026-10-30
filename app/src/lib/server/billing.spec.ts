import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	actionName,
	apiReadOnly,
	applySubscriptionUpdate,
	billingNotice,
	billingState,
	cancelSubscriptionOf,
	enforceBilling,
	getBillingAccount,
	isFreeEmail,
	mapSubscriptionStatus,
	noticeFor,
	recordStripeEvent,
	refusesWrite,
	replaceCheckoutSession,
	setStripeCustomer,
	stripeEventSeen,
	trialDaysLeft,
	trialEnd,
	type BillingAccount
} from './billing';
import type { Database } from './db';
import { accounts, auditLog, stripeEvents, users } from './db/schema';
import { contextA, testDatabase } from './testing';

// The hosted configuration: keys set and writes refused after the trial.
vi.mock('$app/env/private', () => ({
	STRIPE_SECRET_KEY: 'sk_test_unit',
	STRIPE_PRICE_ID: 'price_unit',
	STRIPE_YEARLY_PRICE_ID: '',
	STRIPE_WEBHOOK_SECRET: 'whsec_unit',
	STRIPE_API_BASE: 'http://stripe.test',
	BILLING_REQUIRED: true,
	FREE_ACCOUNT_EMAILS: 'frei@example.org'
}));

// A fake account row: created on 1 January 2026 at noon UTC, so the trial ends on 31 January
// at noon (30 × 24 h later) and the 30 days are 2 January … 31 January.
const createdAt = new Date('2026-01-01T12:00:00.000Z');
const trialEndsAt = new Date('2026-01-31T12:00:00.000Z');

function account(overrides: Partial<BillingAccount> = {}): BillingAccount {
	return {
		subscriptionStatus: 'none',
		trialEndsAt: null,
		currentPeriodEnd: null,
		createdAt,
		...overrides
	};
}

describe('trialEnd', () => {
	it('is 30 days after creation unless a date is stored', () => {
		expect(trialEnd(account())).toEqual(trialEndsAt);
		const stored = new Date('2026-03-15T00:00:00.000Z');
		expect(trialEnd(account({ trialEndsAt: stored }))).toEqual(stored);
	});

	it('counts the days left rounded up', () => {
		// 20 January noon → 11 days; 31 January 11:00 → 1 hour left counts as one day; after: 0.
		expect(trialDaysLeft(account(), new Date('2026-01-20T12:00:00.000Z'))).toBe(11);
		expect(trialDaysLeft(account(), new Date('2026-01-31T11:00:00.000Z'))).toBe(1);
		expect(trialDaysLeft(account(), new Date('2026-01-31T12:00:00.000Z'))).toBe(0);
		expect(trialDaysLeft(account(), new Date('2026-02-10T00:00:00.000Z'))).toBe(0);
	});
});

describe('billingState', () => {
	it('follows the trial while no subscription exists', () => {
		expect(billingState(account(), new Date('2026-01-31T11:59:59.000Z'))).toBe('trialing');
		expect(billingState(account(), new Date('2026-01-31T12:00:00.000Z'))).toBe('expired');
	});

	it('follows the subscription status once there is one', () => {
		const later = new Date('2026-06-01T00:00:00.000Z');
		expect(billingState(account({ subscriptionStatus: 'active' }), later)).toBe('active');
		expect(billingState(account({ subscriptionStatus: 'past_due' }), later)).toBe('past_due');
		expect(billingState(account({ subscriptionStatus: 'canceled' }), later)).toBe('canceled');
		expect(billingState(account({ subscriptionStatus: 'trialing' }), later)).toBe('trialing');
	});

	it('is free for a free account, whatever the trial or Stripe say', () => {
		const later = new Date('2027-01-01T00:00:00.000Z');
		expect(billingState(account({ free: true }), later)).toBe('free');
		expect(billingState(account({ free: true, subscriptionStatus: 'canceled' }), later)).toBe(
			'free'
		);
		expect(noticeFor(account({ free: true }), later, true)).toBeUndefined();
		expect(refusesWrite('free', 'POST', '/objekte', true)).toBe(false);
	});
});

describe('isFreeEmail', () => {
	it('finds the address in the list, ignoring case and spaces', () => {
		expect(isFreeEmail('Mama@Example.org', 'papa@example.org, mama@example.org ')).toBe(true);
		expect(isFreeEmail('mama@example.org', 'papa@example.org')).toBe(false);
		expect(isFreeEmail('mama@example.org', '')).toBe(false);
		expect(isFreeEmail(null, 'mama@example.org')).toBe(false);
	});
});

describe('noticeFor', () => {
	it('announces the trial end with the German date, warning in the last seven days', () => {
		// Trial ends 31 January 12:00 UTC = 13:00 in Berlin, so the date shown is 31.01.2026.
		expect(noticeFor(account(), new Date('2026-01-20T12:00:00.000Z'), true)).toEqual({
			text: 'Deine Testphase endet am 31.01.2026.',
			href: '/abo',
			tone: 'info',
			highlight: true
		});
		// 23 January noon: 8 days left → still info; 24 January noon: 7 days → warning.
		expect(noticeFor(account(), new Date('2026-01-23T12:00:00.000Z'), true)?.tone).toBe('info');
		expect(noticeFor(account(), new Date('2026-01-24T12:00:00.000Z'), true)?.tone).toBe('warning');
	});

	it('shows the trial end in German time', () => {
		// 23:30 UTC on 31 January is already 1 February in Berlin.
		const late = account({ trialEndsAt: new Date('2026-01-31T23:30:00.000Z') });
		expect(noticeFor(late, new Date('2026-01-10T00:00:00.000Z'), true)?.text).toBe(
			'Deine Testphase endet am 01.02.2026.'
		);
	});

	it('marks the expired trial as read-only only when billing is required', () => {
		const after = new Date('2026-02-05T00:00:00.000Z');
		expect(noticeFor(account(), after, true)).toEqual({
			text: 'Deine Testphase ist abgelaufen. Du kannst nur noch lesen.',
			href: '/abo',
			tone: 'danger'
		});
		expect(noticeFor(account(), after, false)).toEqual({
			text: 'Deine Testphase ist abgelaufen.',
			href: '/abo',
			tone: 'info'
		});
	});

	it('warns about a failed payment and says nothing for active subscriptions', () => {
		const now = new Date('2026-02-05T00:00:00.000Z');
		expect(noticeFor(account({ subscriptionStatus: 'past_due' }), now, true)).toEqual({
			text: 'Die letzte Zahlung ist fehlgeschlagen.',
			href: '/abo',
			tone: 'warning'
		});
		expect(noticeFor(account({ subscriptionStatus: 'active' }), now, true)).toBeUndefined();
		expect(noticeFor(account({ subscriptionStatus: 'trialing' }), now, true)).toBeUndefined();
		expect(noticeFor(account({ subscriptionStatus: 'canceled' }), now, true)?.tone).toBe('danger');
	});
});

describe('refusesWrite', () => {
	it('refuses POSTs of read-only accounts except on the billing pages', () => {
		expect(refusesWrite('expired', 'POST', '/objekte', true)).toBe(true);
		expect(refusesWrite('canceled', 'POST', '/vertraege/1/mietkonto', true)).toBe(true);
		expect(refusesWrite('expired', 'POST', '/abo', true)).toBe(false);
		expect(refusesWrite('expired', 'POST', '/abo/', true)).toBe(false);
		expect(refusesWrite('expired', 'POST', '/abmelden', true)).toBe(false);
		expect(refusesWrite('expired', 'POST', '/api/webhooks/stripe', true)).toBe(false);
	});

	it('lets read-only accounts delete the account and secure their sign-in', () => {
		expect(refusesWrite('expired', 'POST', '/einstellungen/konto', true, 'delete')).toBe(false);
		expect(refusesWrite('canceled', 'POST', '/einstellungen/profil', true, 'password')).toBe(false);
		expect(refusesWrite('expired', 'POST', '/einstellungen/ki-assistenten', true, 'revoke')).toBe(
			false
		);
		expect(refusesWrite('expired', 'POST', '/einstellungen/ki-assistenten', true, 'create')).toBe(
			true
		);
		expect(refusesWrite('canceled', 'POST', '/einstellungen/profil/', true, 'profile')).toBe(false);
		// The Fristen mail can be turned off, as each mail says.
		expect(refusesWrite('expired', 'POST', '/einstellungen/kalender', true, 'mail')).toBe(false);
		expect(refusesWrite('expired', 'POST', '/einstellungen/kalender', true, 'create')).toBe(true);
		// The pages of reset and address confirmation links finish what the profile started.
		expect(refusesWrite('expired', 'POST', '/passwort-zuruecksetzen/abc', true)).toBe(false);
		expect(refusesWrite('canceled', 'POST', '/e-mail-bestaetigen/abc', true)).toBe(false);
		// A registration link creates another account, which is not the read-only one.
		expect(refusesWrite('expired', 'POST', '/registrieren/abc', true)).toBe(false);
		// Everything else on those pages changes data and stays refused.
		expect(refusesWrite('expired', 'POST', '/einstellungen/konto', true, 'demo')).toBe(true);
		expect(refusesWrite('expired', 'POST', '/einstellungen/konto', true)).toBe(true);
		expect(refusesWrite('canceled', 'POST', '/einstellungen/profil', true, 'landlord')).toBe(true);
		expect(refusesWrite('expired', 'POST', '/objekte', true, 'delete')).toBe(true);
	});

	it('reads the action name the way SvelteKit does', () => {
		expect(actionName(new URL('http://x/einstellungen/konto?/delete').searchParams)).toBe('delete');
		expect(actionName(new URL('http://x/a?x=1&/password').searchParams)).toBe('password');
		expect(actionName(new URL('http://x/a').searchParams)).toBe('default');
	});

	it('lets reads, trials, active and past-due accounts and unrequired billing through', () => {
		expect(refusesWrite('expired', 'GET', '/objekte', true)).toBe(false);
		expect(refusesWrite('trialing', 'POST', '/objekte', true)).toBe(false);
		expect(refusesWrite('active', 'POST', '/objekte', true)).toBe(false);
		expect(refusesWrite('past_due', 'POST', '/objekte', true)).toBe(false);
		expect(refusesWrite('expired', 'POST', '/objekte', false)).toBe(false);
	});
});

describe('mapSubscriptionStatus', () => {
	it('maps Stripe statuses onto the account column', () => {
		expect(mapSubscriptionStatus('trialing')).toBe('trialing');
		expect(mapSubscriptionStatus('active')).toBe('active');
		expect(mapSubscriptionStatus('past_due')).toBe('past_due');
		expect(mapSubscriptionStatus('canceled')).toBe('canceled');
		expect(mapSubscriptionStatus('unpaid')).toBe('canceled');
		expect(mapSubscriptionStatus('incomplete_expired')).toBe('canceled');
		expect(mapSubscriptionStatus('incomplete')).toBe('none');
	});
});

describe('with a database', () => {
	let db: Database;

	beforeEach(async () => {
		db = await testDatabase();
	});

	async function row(id: string) {
		const [found] = await db.select().from(accounts).where(eq(accounts.id, id));
		return found;
	}

	it('tells the API whether the account may only read', async () => {
		expect(await apiReadOnly(db, 'a')).toBe(false);
		await db
			.update(accounts)
			.set({ createdAt: new Date('2020-01-01'), subscriptionStatus: 'none' })
			.where(eq(accounts.id, 'a'));
		expect(await apiReadOnly(db, 'a')).toBe(true);
		await db.update(accounts).set({ subscriptionStatus: 'active' }).where(eq(accounts.id, 'a'));
		expect(await apiReadOnly(db, 'a')).toBe(false);
		expect(await apiReadOnly(db, 'missing')).toBe(false);
	});

	it('makes an account free by its owner, never by a manager', async () => {
		const expired = { createdAt: new Date('2020-01-01'), subscriptionStatus: 'none' as const };
		await db.update(accounts).set(expired).where(eq(accounts.id, 'a'));
		expect((await getBillingAccount(db, 'a'))?.free).toBe(false);
		await db.insert(users).values({
			id: 'manager-a',
			accountId: 'a',
			email: 'frei@example.org',
			passwordHash: 'x',
			role: 'manager'
		});
		expect((await getBillingAccount(db, 'a'))?.free).toBe(false);
		expect(await apiReadOnly(db, 'a')).toBe(true);

		await db.delete(users).where(eq(users.id, 'manager-a'));
		await db.update(users).set({ email: 'frei@example.org' }).where(eq(users.id, 'user-a'));
		expect((await getBillingAccount(db, 'a'))?.free).toBe(true);
		expect(await apiReadOnly(db, 'a')).toBe(false);
	});

	it('stores the Stripe customer with an audit entry', async () => {
		await setStripeCustomer(db, contextA, 'cus_a');
		expect((await row('a')).stripeCustomerId).toBe('cus_a');
		expect((await row('b')).stripeCustomerId).toBeNull();
		const entries = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ userId: 'user-a', entity: 'account', entityId: 'a' });
	});

	it('keeps the first stored customer and answers with it', async () => {
		expect(await setStripeCustomer(db, contextA, 'cus_first')).toBe('cus_first');
		expect(await setStripeCustomer(db, contextA, 'cus_second')).toBe('cus_first');
		expect((await row('a')).stripeCustomerId).toBe('cus_first');
		const entries = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(entries).toHaveLength(1);
	});

	it('applies a subscription update to the account of the customer, once', async () => {
		await setStripeCustomer(db, contextA, 'cus_a');
		await setStripeCustomer(db, { accountId: 'b', userId: 'user-b' }, 'cus_b');
		const periodEnd = new Date('2026-11-20T10:00:00.000Z');
		const event = { id: 'evt_1', type: 'customer.subscription.updated' };
		const accountId = await applySubscriptionUpdate(db, event, {
			customerId: 'cus_a',
			subscriptionId: 'sub_a',
			status: 'active',
			currentPeriodEnd: periodEnd
		});
		expect(accountId).toBe('a');
		expect(await row('a')).toMatchObject({
			stripeSubscriptionId: 'sub_a',
			subscriptionStatus: 'active',
			currentPeriodEnd: periodEnd
		});
		// Does not leak into another account.
		expect(await row('b')).toMatchObject({
			stripeSubscriptionId: null,
			subscriptionStatus: 'none',
			currentPeriodEnd: null
		});
		expect(await stripeEventSeen(db, 'evt_1')).toBe(true);
		expect(await stripeEventSeen(db, 'evt_2')).toBe(false);
		const entries = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		const fromStripe = entries.filter((entry) => entry.userId === null);
		expect(fromStripe).toHaveLength(1);
		expect(fromStripe[0].summary).toBe('Abo-Status von Stripe übernommen: Aktiv (bis 20.11.2026)');
	});

	it('keeps the status for an incomplete subscription and maps unpaid to canceled', async () => {
		await setStripeCustomer(db, contextA, 'cus_a');
		await db.update(accounts).set({ subscriptionStatus: 'active' }).where(eq(accounts.id, 'a'));
		await applySubscriptionUpdate(
			db,
			{ id: 'evt_1', type: 'customer.subscription.updated' },
			{ customerId: 'cus_a', subscriptionId: 'sub_a', status: 'incomplete', currentPeriodEnd: null }
		);
		expect((await row('a')).subscriptionStatus).toBe('active');
		await applySubscriptionUpdate(
			db,
			{ id: 'evt_2', type: 'customer.subscription.deleted' },
			{ customerId: 'cus_a', subscriptionId: 'sub_a', status: 'unpaid', currentPeriodEnd: null }
		);
		expect((await row('a')).subscriptionStatus).toBe('canceled');
	});

	it('ignores a late end of an older subscription while a newer one runs', async () => {
		await setStripeCustomer(db, contextA, 'cus_a');
		const periodEnd = new Date('2026-11-20T10:00:00.000Z');
		await applySubscriptionUpdate(
			db,
			{ id: 'evt_1', type: 'customer.subscription.updated' },
			{
				customerId: 'cus_a',
				subscriptionId: 'sub_new',
				status: 'active',
				currentPeriodEnd: periodEnd
			}
		);
		// A retried delivery about sub_old, which ended before sub_new started.
		const accountId = await applySubscriptionUpdate(
			db,
			{ id: 'evt_2', type: 'customer.subscription.deleted' },
			{ customerId: 'cus_a', subscriptionId: 'sub_old', status: 'canceled', currentPeriodEnd: null }
		);
		expect(accountId).toBe('a');
		expect(await row('a')).toMatchObject({
			stripeSubscriptionId: 'sub_new',
			subscriptionStatus: 'active',
			currentPeriodEnd: periodEnd
		});
		expect(await stripeEventSeen(db, 'evt_2')).toBe(true);
		// Once the running one has ended, another subscription takes its place.
		await applySubscriptionUpdate(
			db,
			{ id: 'evt_3', type: 'customer.subscription.deleted' },
			{ customerId: 'cus_a', subscriptionId: 'sub_new', status: 'canceled', currentPeriodEnd: null }
		);
		await applySubscriptionUpdate(
			db,
			{ id: 'evt_4', type: 'customer.subscription.updated' },
			{
				customerId: 'cus_a',
				subscriptionId: 'sub_next',
				status: 'trialing',
				currentPeriodEnd: null
			}
		);
		expect(await row('a')).toMatchObject({
			stripeSubscriptionId: 'sub_next',
			subscriptionStatus: 'trialing'
		});
	});

	it('returns undefined for an unknown customer and changes nothing', async () => {
		const accountId = await applySubscriptionUpdate(
			db,
			{ id: 'evt_9', type: 'customer.subscription.updated' },
			{
				customerId: 'cus_nobody',
				subscriptionId: 'sub_x',
				status: 'active',
				currentPeriodEnd: null
			}
		);
		expect(accountId).toBeUndefined();
		expect(await stripeEventSeen(db, 'evt_9')).toBe(false);
		expect((await row('a')).subscriptionStatus).toBe('none');
	});

	/** Answers every Stripe call with the next of `answers` and records the method and URL. */
	function stripeAnswers(...answers: { status: number; body: unknown }[]) {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: RequestInit) => {
				calls.push(`${init.method} ${url}`);
				const next = answers.shift() ?? { status: 500, body: {} };
				return new Response(JSON.stringify(next.body), { status: next.status });
			})
		);
		return calls;
	}

	describe('cancelSubscriptionOf', () => {
		afterEach(() => {
			vi.unstubAllGlobals();
		});

		const list = 'GET http://stripe.test/v1/subscriptions?customer=cus_a&limit=100';

		/** Stripe's answer to the list: the customer's subscriptions that are not canceled. */
		function listed(...subscriptions: { id: string; status: string }[]) {
			return { status: 200, body: { object: 'list', has_more: false, data: subscriptions } };
		}

		it('cancels every running subscription of the customer at Stripe', async () => {
			await setStripeCustomer(db, contextA, 'cus_a');
			// The stored one, and one whose Checkout webhook has not arrived yet.
			await db
				.update(accounts)
				.set({ stripeSubscriptionId: 'sub_a', subscriptionStatus: 'active' })
				.where(eq(accounts.id, 'a'));
			const calls = stripeAnswers(
				listed({ id: 'sub_a', status: 'active' }, { id: 'sub_b', status: 'incomplete' }),
				{ status: 200, body: { id: 'sub_a', status: 'canceled' } },
				{ status: 200, body: { id: 'sub_b', status: 'canceled' } }
			);
			expect(await cancelSubscriptionOf(db, 'a')).toBe(true);
			expect(calls).toEqual([
				list,
				'DELETE http://stripe.test/v1/subscriptions/sub_a',
				'DELETE http://stripe.test/v1/subscriptions/sub_b'
			]);
		});

		it('calls nobody without a Stripe customer and cancels nothing that has ended', async () => {
			const calls = stripeAnswers(listed(), listed({ id: 'sub_a', status: 'unpaid' }));
			// Neither account has a Stripe customer before its first Checkout.
			expect(await cancelSubscriptionOf(db, 'a')).toBe(true);
			expect(await cancelSubscriptionOf(db, 'b')).toBe(true);
			expect(calls).toEqual([]);
			await setStripeCustomer(db, contextA, 'cus_a');
			expect(await cancelSubscriptionOf(db, 'a')).toBe(true);
			expect(await cancelSubscriptionOf(db, 'a')).toBe(true);
			expect(calls).toEqual([list, list]);
		});

		it('refuses while Stripe cannot cancel, unless the subscription is gone', async () => {
			await setStripeCustomer(db, contextA, 'cus_a');
			const running = listed({ id: 'sub_a', status: 'past_due' });
			// Stripe fails, and the subscription still runs: the account must stay.
			stripeAnswers(
				running,
				{ status: 500, body: {} },
				{ status: 200, body: { status: 'past_due' } }
			);
			expect(await cancelSubscriptionOf(db, 'a')).toBe(false);
			// Canceled in the meantime: nothing bills the account any more.
			stripeAnswers(
				running,
				{ status: 400, body: {} },
				{ status: 200, body: { status: 'canceled' } }
			);
			expect(await cancelSubscriptionOf(db, 'a')).toBe(true);
			// Neither cancelling nor reading the subscription works: it may still bill.
			stripeAnswers(running, { status: 500, body: {} }, { status: 500, body: {} });
			expect(await cancelSubscriptionOf(db, 'a')).toBe(false);
			// Unknown to Stripe.
			stripeAnswers(running, { status: 404, body: {} });
			expect(await cancelSubscriptionOf(db, 'a')).toBe(true);
			// The list fails.
			stripeAnswers({ status: 500, body: {} });
			expect(await cancelSubscriptionOf(db, 'a')).toBe(false);
			// Stripe not reachable at all.
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => {
					throw new TypeError('fetch failed');
				})
			);
			expect(await cancelSubscriptionOf(db, 'a')).toBe(false);
		});
	});

	describe('a second subscription', () => {
		afterEach(() => {
			vi.unstubAllGlobals();
		});

		/** Account a with the running sub_a and the Checkout cs_2 still pending. */
		async function subscribed() {
			await setStripeCustomer(db, contextA, 'cus_a');
			await db
				.update(accounts)
				.set({
					stripeSubscriptionId: 'sub_a',
					subscriptionStatus: 'active',
					stripeCheckoutSessionId: 'cs_2'
				})
				.where(eq(accounts.id, 'a'));
		}

		const completedB = {
			customerId: 'cus_a',
			subscriptionId: 'sub_b',
			status: 'active',
			currentPeriodEnd: null,
			checkoutSessionId: 'cs_2'
		};

		it('is canceled at once while the stored one still bills, with an audit entry', async () => {
			await subscribed();
			const calls = stripeAnswers(
				{ status: 200, body: { id: 'sub_a', status: 'active' } },
				{ status: 200, body: { id: 'sub_b', status: 'canceled' } }
			);
			const event = { id: 'evt_b', type: 'checkout.session.completed' };
			expect(await applySubscriptionUpdate(db, event, completedB)).toBe('a');
			expect(calls).toEqual([
				'GET http://stripe.test/v1/subscriptions/sub_a',
				'DELETE http://stripe.test/v1/subscriptions/sub_b'
			]);
			// The account keeps the subscription it pays for; the Checkout is no longer pending.
			expect(await row('a')).toMatchObject({
				stripeSubscriptionId: 'sub_a',
				subscriptionStatus: 'active',
				stripeCheckoutSessionId: null
			});
			expect(await stripeEventSeen(db, 'evt_b')).toBe(true);
			const summaries = (await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'))).map(
				(entry) => entry.summary
			);
			expect(summaries).toContain('Zweites Abo bei Stripe sofort gekündigt: sub_b');
		});

		it('takes the place of a stored one that has ended at Stripe', async () => {
			await subscribed();
			// sub_a ended, but its webhook has not arrived yet.
			const calls = stripeAnswers({ status: 200, body: { id: 'sub_a', status: 'canceled' } });
			await applySubscriptionUpdate(
				db,
				{ id: 'evt_b', type: 'checkout.session.completed' },
				completedB
			);
			expect(calls).toEqual(['GET http://stripe.test/v1/subscriptions/sub_a']);
			expect(await row('a')).toMatchObject({
				stripeSubscriptionId: 'sub_b',
				subscriptionStatus: 'active',
				stripeCheckoutSessionId: null
			});
		});

		it('takes the place of a stored one Stripe does not know, and retries when Stripe fails', async () => {
			await subscribed();
			stripeAnswers({ status: 500, body: {} });
			const event = { id: 'evt_b', type: 'checkout.session.completed' };
			await expect(applySubscriptionUpdate(db, event, completedB)).rejects.toThrow();
			expect(await stripeEventSeen(db, 'evt_b')).toBe(false);
			expect(await row('a')).toMatchObject({ stripeSubscriptionId: 'sub_a' });

			stripeAnswers({ status: 404, body: {} });
			await applySubscriptionUpdate(db, event, completedB);
			expect(await row('a')).toMatchObject({
				stripeSubscriptionId: 'sub_b',
				subscriptionStatus: 'active'
			});
		});

		it('throws while Stripe cannot cancel it, so Stripe delivers the event again', async () => {
			await subscribed();
			stripeAnswers(
				{ status: 200, body: { id: 'sub_a', status: 'active' } },
				{ status: 500, body: {} },
				{ status: 200, body: { id: 'sub_b', status: 'active' } }
			);
			await expect(
				applySubscriptionUpdate(
					db,
					{ id: 'evt_b', type: 'customer.subscription.updated' },
					completedB
				)
			).rejects.toThrow(/sub_b/);
			expect(await stripeEventSeen(db, 'evt_b')).toBe(false);
			expect(await row('a')).toMatchObject({
				stripeSubscriptionId: 'sub_a',
				stripeCheckoutSessionId: 'cs_2'
			});
		});

		it('leaves a pending Checkout alone when another session completes', async () => {
			await subscribed();
			const calls = stripeAnswers();
			await applySubscriptionUpdate(
				db,
				{ id: 'evt_a', type: 'checkout.session.completed' },
				{ ...completedB, subscriptionId: 'sub_a', checkoutSessionId: 'cs_1' }
			);
			expect(calls).toEqual([]);
			expect((await row('a')).stripeCheckoutSessionId).toBe('cs_2');
		});
	});

	it('stores a Checkout session only over the one the request read', async () => {
		expect(await replaceCheckoutSession(db, 'a', null, 'cs_1')).toBe(true);
		// A second request that also read "none" loses.
		expect(await replaceCheckoutSession(db, 'a', null, 'cs_2')).toBe(false);
		expect(await replaceCheckoutSession(db, 'a', 'cs_0', 'cs_2')).toBe(false);
		expect((await row('a')).stripeCheckoutSessionId).toBe('cs_1');
		expect(await replaceCheckoutSession(db, 'a', 'cs_1', 'cs_2')).toBe(true);
		expect(await row('a')).toMatchObject({ stripeCheckoutSessionId: 'cs_2' });
		expect((await row('b')).stripeCheckoutSessionId).toBeNull();
	});

	it('records an event once', async () => {
		await recordStripeEvent(db, 'evt_x', 'invoice.paid');
		await recordStripeEvent(db, 'evt_x', 'invoice.paid');
		expect(await db.select().from(stripeEvents)).toHaveLength(1);
	});

	it('forgets events long past Stripe retrying them', async () => {
		const day = 24 * 60 * 60 * 1000;
		await db.insert(stripeEvents).values([
			{ id: 'evt_old', type: 'invoice.paid', receivedAt: new Date(Date.now() - 31 * day) },
			{ id: 'evt_recent', type: 'invoice.paid', receivedAt: new Date(Date.now() - 4 * day) }
		]);
		await recordStripeEvent(db, 'evt_new', 'invoice.paid');
		const ids = (await db.select().from(stripeEvents)).map((event) => event.id).sort();
		expect(ids).toEqual(['evt_new', 'evt_recent']);
	});

	function requestEvent(method: string, pathname: string, user = true) {
		return {
			locals: {
				db,
				user: user
					? { id: 'user-a', email: 'a@example.org', accountId: 'a', name: null, role: 'owner' }
					: undefined
			},
			request: new Request(`http://localhost${pathname}`, { method }),
			url: new URL(`http://localhost${pathname}`)
		} as unknown as Parameters<typeof enforceBilling>[0];
	}

	it('enforces read-only after the trial and shows the notice before', async () => {
		// A fresh account: trial running, every request passes, the notice names the date.
		await expect(enforceBilling(requestEvent('POST', '/objekte'))).resolves.toBeUndefined();
		const fresh = await billingNotice(requestEvent('GET', '/').locals);
		expect(fresh?.text).toMatch(/^Deine Testphase endet am \d{2}\.\d{2}\.\d{4}\.$/);
		expect(fresh?.tone).toBe('info');

		// Trial over: writes refused with the German sentence, reads and the billing pages pass.
		await db
			.update(accounts)
			.set({ trialEndsAt: new Date('2026-01-01T00:00:00.000Z') })
			.where(eq(accounts.id, 'a'));
		await expect(enforceBilling(requestEvent('POST', '/objekte'))).rejects.toMatchObject({
			status: 403,
			body: { message: 'Dein Konto ist nur noch lesbar, bis ein Abo abgeschlossen ist.' }
		});
		await expect(enforceBilling(requestEvent('GET', '/objekte'))).resolves.toBeUndefined();
		await expect(enforceBilling(requestEvent('POST', '/abo'))).resolves.toBeUndefined();
		await expect(enforceBilling(requestEvent('POST', '/abmelden'))).resolves.toBeUndefined();
		await expect(enforceBilling(requestEvent('POST', '/objekte', false))).resolves.toBeUndefined();
		// Leaving and securing the sign-in work without paying; the sender block, the demo data and
		// the data import do not.
		await expect(
			enforceBilling(requestEvent('POST', '/einstellungen/konto?/delete'))
		).resolves.toBeUndefined();
		await expect(
			enforceBilling(requestEvent('POST', '/einstellungen/profil?/password'))
		).resolves.toBeUndefined();
		await expect(
			enforceBilling(requestEvent('POST', '/einstellungen/profil?/landlord'))
		).rejects.toMatchObject({ status: 403 });
		await expect(
			enforceBilling(requestEvent('POST', '/einstellungen/konto?/demo'))
		).rejects.toMatchObject({ status: 403 });
		await expect(
			enforceBilling(requestEvent('POST', '/einstellungen/datenuebernahme?/commit'))
		).rejects.toMatchObject({ status: 403 });
		expect(await billingNotice(requestEvent('GET', '/').locals)).toEqual({
			text: 'Deine Testphase ist abgelaufen. Du kannst nur noch lesen.',
			href: '/abo',
			tone: 'danger'
		});

		// Subscribed: nothing is refused, no notice. Account b is untouched by all of this.
		await db.update(accounts).set({ subscriptionStatus: 'active' }).where(eq(accounts.id, 'a'));
		await expect(enforceBilling(requestEvent('POST', '/objekte'))).resolves.toBeUndefined();
		expect(await billingNotice(requestEvent('GET', '/').locals)).toBeUndefined();
		expect((await row('b')).subscriptionStatus).toBe('none');
	});
});
