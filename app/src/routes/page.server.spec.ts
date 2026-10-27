import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBankAccount } from '#lib/server/bank/accounts.ts';
import type { Database } from '#lib/server/db/index.ts';
import { accounts } from '#lib/server/db/schema.ts';
import { createPayment, postCharge } from '#lib/server/ledger.ts';
import {
	contextA,
	outcome,
	routeEvent,
	seedLease,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { GET as health } from './health/+server';
import { actions as balanceActions, load as loadBalances } from './mietkonto/+page.server';
import { load as loadLayout } from './+layout.server';
import { load as loadTasks } from './aufgaben/+page.server';
import { load } from './+page.server';

// The start page, the root layout, the balances of all leases and the health check.

const env = vi.hoisted(() => ({
	DEMO: false,
	STRIPE_SECRET_KEY: '',
	STRIPE_PRICE_ID: '',
	STRIPE_YEARLY_PRICE_ID: '',
	FREE_ACCOUNT_EMAILS: '',
	BILLING_REQUIRED: false,
	GENESIS_API_TOKEN: ''
}));
vi.mock('$app/env/private', () => env);

let db: Database;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-03-10T10:00:00Z'));
	Object.assign(env, { STRIPE_SECRET_KEY: '', STRIPE_PRICE_ID: '' });
	db = await testDatabase();
});

afterEach(() => {
	vi.useRealTimers();
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, options)));
}

describe('start page', () => {
	it('leads to Aufgaben', async () => {
		expect(await run(load)).toMatchObject({ redirect: '/aufgaben' });
	});

	it('shows the first-run checklist until there is a lease and a bank account', async () => {
		expect(await run(loadTasks)).toMatchObject({
			data: {
				firstRun: {
					properties: false,
					units: false,
					leases: false,
					bankAccounts: false,
					firstPropertyId: null
				}
			}
		});
		const { propertyId, unitId } = await seedUnit(db, 'a');
		await seedLease(db, 'a', unitId);
		expect(await run(loadTasks)).toMatchObject({
			data: {
				firstRun: {
					properties: true,
					leases: true,
					bankAccounts: false,
					firstPropertyId: propertyId
				}
			}
		});
		await createBankAccount(db, contextA, {
			name: 'Mietkonto',
			iban: 'DE02120300000000202051',
			bic: null,
			holder: 'Oliver'
		});
		expect(await run(loadTasks)).toMatchObject({ data: { firstRun: null } });
	});

	it('counts arrears, vacant units and the account’s own data only', async () => {
		const { unitId } = await seedUnit(db, 'a');
		await seedUnit(db, 'a', { name: 'Leer', propertyName: 'Zweites' });
		await seedLease(db, 'a', unitId, { startDate: '2026-01-01' });
		const other = await seedUnit(db, 'b');
		await seedLease(db, 'b', other.unitId);
		expect(await run(loadTasks)).toMatchObject({
			data: {
				attention: {
					arrearsTotal: 240000,
					arrearsCount: 1,
					unmatched: 0,
					vacantCount: 1,
					vacant: [{ label: 'Leer · Zweites' }]
				}
			}
		});
	});
});

describe('mietkonto', () => {
	it('lists balances with arrears first and filters them', async () => {
		const first = await seedUnit(db, 'a', { name: 'A' });
		const second = await seedUnit(db, 'a', { name: 'B' });
		const paid = await seedLease(db, 'a', first.unitId, { startDate: '2026-03-01' });
		const owing = await seedLease(db, 'a', second.unitId, { startDate: '2026-02-01' });
		await createPayment(db, contextA, {
			leaseId: paid,
			date: '2026-03-01',
			amount: 100000,
			source: 'manual',
			note: null
		});
		// Starts next month: nothing due yet, listed after A by its name.
		const third = await seedUnit(db, 'a', { name: 'C' });
		const upcoming = await seedLease(db, 'a', third.unitId, { startDate: '2026-04-01' });
		expect(await run(loadBalances, { url: '/mietkonto' })).toMatchObject({
			data: {
				leaseCount: 3,
				rows: [{ leaseId: owing }, { leaseId: paid, balance: -20000 }, { leaseId: upcoming }],
				stats: { arrearsCount: 1, creditTotal: 20000, creditCount: 1 }
			}
		});
		expect(await run(loadBalances, { url: '/mietkonto?filter=rueckstaende' })).toMatchObject({
			data: { onlyArrears: true, rows: [{ leaseId: owing }] }
		});
	});

	it('books "Miete ist da": what is owed, at most one month, dated today', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const owing = await seedLease(db, 'a', unitId, { startDate: '2026-02-01' });
		const received = () => run(balanceActions.received, { form: { leaseId: owing } });
		const rentReceived = async () =>
			(
				(await run(loadBalances, { url: '/mietkonto' })) as {
					data: { rows: { rentReceived: number | null }[] };
				}
			).data.rows[0].rentReceived;

		// Two months owed: each click books one month's rent.
		expect(await rentReceived()).toBe(80000);
		expect(await received()).toMatchObject({
			data: { received: { leaseId: owing, amount: 80000 } }
		});
		expect(await received()).toMatchObject({ data: { received: { amount: 80000 } } });
		expect(await rentReceived()).toBeNull();
		expect(await received()).toMatchObject({ fail: 400 });
		expect(await run(balanceActions.received, { form: { leaseId: 'fremd' } })).toMatchObject({
			fail: 404
		});
	});

	it('offers no "Miete ist da" for an ended lease or one without rent', async () => {
		const ended = await seedUnit(db, 'a', { name: 'A' });
		const free = await seedUnit(db, 'a', { name: 'B' });
		const endedLease = await seedLease(db, 'a', ended.unitId, {
			startDate: '2025-12-01',
			endDate: '2026-01-31'
		});
		const freeLease = await seedLease(db, 'a', free.unitId, {
			startDate: '2026-02-01',
			baseRent: 0,
			operatingCostPrepayment: 0,
			heatingCostPrepayment: 0
		});
		// Owes a correction, but has no rent to book as "Miete ist da".
		await postCharge(db, contextA, {
			leaseId: freeLease,
			kind: 'adjustment',
			period: '2026-03',
			dueDate: '2026-03-01',
			amount: 5000
		});
		const loaded = (await run(loadBalances, { url: '/mietkonto' })) as {
			data: { rows: { leaseId: string; balance: number; rentReceived: number | null }[] };
		};
		expect(loaded.data.rows.find((row) => row.leaseId === endedLease)).toMatchObject({
			rentReceived: null
		});
		expect(loaded.data.rows.find((row) => row.leaseId === freeLease)).toMatchObject({
			rentReceived: null
		});
		expect(await run(balanceActions.received, { form: { leaseId: endedLease } })).toMatchObject({
			fail: 400
		});
		expect(await run(balanceActions.received, { form: {} })).toMatchObject({ fail: 404 });
	});
});

describe('layout', () => {
	it('passes the user and no billing notice while billing is off', async () => {
		expect(await run(loadLayout)).toEqual({
			data: {
				email: 'a@example.org',
				name: null,
				role: 'owner',
				theme: 'system',
				billingEnabled: false,
				demo: false,
				prelaunch: false,
				notice: undefined
			}
		});
		expect(await run(loadLayout, { user: null })).toMatchObject({
			data: { email: undefined, notice: undefined }
		});
	});

	it('names the end of the trial when billing is on', async () => {
		Object.assign(env, { STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_ID: 'price' });
		await db
			.update(accounts)
			.set({ trialEndsAt: new Date('2026-03-15T00:00:00Z') })
			.where(eq(accounts.id, 'a'));
		expect(await run(loadLayout)).toMatchObject({
			data: { billingEnabled: true, notice: { href: '/abo' } }
		});
	});
});

describe('health', () => {
	it('answers ok once the database answers', async () => {
		const response = (await run(health)) as { data: Response };
		expect(await response.data.json()).toEqual({ status: 'ok' });
	});
});
