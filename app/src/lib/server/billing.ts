import type { RequestEvent } from '@sveltejs/kit';
import { STRIPE_PRICE_ID, STRIPE_SECRET_KEY } from '$app/env/private';

// Subscriptions through Stripe. The hosted variant configures the keys; self-hosting leaves them
// unset, and then nothing about billing is shown. The billing feature fills in the rest.

export function billingEnabled(): boolean {
	return Boolean(STRIPE_SECRET_KEY && STRIPE_PRICE_ID);
}

/**
 * Called by the hook for every signed-in request. With BILLING_REQUIRED, accounts whose trial has
 * ended without a subscription may only read: writes outside the billing pages are refused.
 * The billing feature implements this; until then every request passes.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function enforceBilling(event: RequestEvent): Promise<void> {}

export type BillingNotice = { text: string; href: string; tone: 'info' | 'warning' | 'danger' };

/**
 * A line shown above every page while the trial runs out or the account is read-only, with a
 * link to the subscription page. The billing feature implements this; until then there is none.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function billingNotice(locals: App.Locals): Promise<BillingNotice | undefined> {
	return undefined;
}
