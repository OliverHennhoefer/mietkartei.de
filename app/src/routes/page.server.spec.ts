import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBankAccount } from '#lib/server/bank/accounts.ts';
import type { Database } from '#lib/server/db/index.ts';
import { fingerprintRows } from '#lib/domain/bank-matching.ts';
import { accounts, bankConnections, bankTransactions } from '#lib/server/db/schema.ts';
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
import { load as loadDeadlines } from './fristen/+page.server';
import { load } from './+page.server';

// The start page, the root layout, the balances of all leases and the health check.

const env = vi.hoisted(() => ({
	DEMO: false,
	HOSTED: false,
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

	it('reminds of arrears and statements not loaded, lists vacant units, the account’s own only', async () => {
		const { unitId } = await seedUnit(db, 'a');
		await seedUnit(db, 'a', { name: 'Leer', propertyName: 'Zweites' });
		await seedLease(db, 'a', unitId, { startDate: '2026-01-01' });
		await createBankAccount(db, contextA, {
			name: 'Mietkonto',
			iban: 'DE02120300000000202051',
			bic: null,
			holder: 'Oliver'
		});
		const other = await seedUnit(db, 'b');
		await seedLease(db, 'b', other.unitId);
		const result = await run(loadTasks);
		expect(result).toMatchObject({
			data: {
				reminders: [
					{ kind: 'arrears', title: 'Rückstände bei 1\u00a0Mietvertrag', amount: 240000 },
					{
						kind: 'bank_import',
						title: 'Kontoauszug laden: Mietkonto',
						href: '/bank/import'
					},
					{ kind: 'vacancy', title: 'Mietvertrag anlegen: Leer · Zweites' }
				]
			}
		});
		// No unmatched transactions: no reminder to assign them.
		expect('data' in result && (result.data as { reminders: unknown[] }).reminders).toHaveLength(3);
	});
});

describe('start page reminders', () => {
	type Reminder = { id: string; kind: string; title: string; href: string };
	async function reminders(): Promise<Reminder[]> {
		const result = await run(loadTasks);
		// The seeded lease owes its first rent; the tests here are about the others.
		const list = 'data' in result ? (result.data as { reminders: Reminder[] }).reminders : [];
		return list.filter((reminder) => reminder.kind !== 'arrears');
	}
	async function bankAccount(name: string, iban: string): Promise<string> {
		const created = await createBankAccount(db, contextA, {
			name,
			iban,
			bic: null,
			holder: 'Oliver'
		});
		if (!created.ok) throw new Error('duplicate');
		return created.id;
	}
	async function transaction(
		bankAccountId: string,
		bookingDate: string,
		status: 'unmatched' | 'matched'
	) {
		const [row] = await fingerprintRows([
			{
				bookingDate,
				valueDate: bookingDate,
				amount: 100000,
				counterpartName: 'Mieter',
				counterpartIban: null,
				purpose: 'Miete',
				externalId: null
			}
		]);
		await db.insert(bankTransactions).values({ accountId: 'a', bankAccountId, status, ...row });
	}

	beforeEach(async () => {
		const { unitId } = await seedUnit(db, 'a');
		await seedLease(db, 'a', unitId, { startDate: '2026-03-01' });
	});

	it('asks to assign unmatched transactions, not to load a recent statement', async () => {
		const id = await bankAccount('Mietkonto', 'DE02120300000000202051');
		await transaction(id, '2026-03-05', 'unmatched');
		expect(await reminders()).toEqual([
			expect.objectContaining({ kind: 'bank', title: '1\u00a0Bankumsatz zuordnen', href: '/bank' })
		]);
	});

	it('asks to renew an expired Bankabruf and leaves an active one alone', async () => {
		const expired = await bankAccount('Altes Konto', 'DE02120300000000202051');
		const active = await bankAccount('Neues Konto', 'DE89370400440532013000');
		const connection = {
			accountId: 'a',
			aspspName: 'Bank',
			aspspCountry: 'DE',
			sessionId: 's',
			accountUid: 'u'
		};
		await db.insert(bankConnections).values([
			{ ...connection, bankAccountId: expired, validUntil: new Date('2026-03-01T00:00:00Z') },
			{ ...connection, bankAccountId: active, validUntil: new Date('2026-06-01T00:00:00Z') }
		]);
		expect(await reminders()).toEqual([
			expect.objectContaining({
				id: `bank_import:${expired}`,
				title: 'Bankabruf erneuern: Altes Konto',
				href: `/bank/konten/${expired}/abruf`
			})
		]);
	});

	it('names an old statement by its last transaction and lists five vacant units, then the rest', async () => {
		const id = await bankAccount('Mietkonto', 'DE02120300000000202051');
		await transaction(id, '2026-01-15', 'matched');
		for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) await seedUnit(db, 'a', { name });
		const list = await reminders();
		expect(list[0]).toMatchObject({
			kind: 'bank_import',
			title: 'Kontoauszug laden: Mietkonto',
			detail: 'Der letzte Umsatz ist vom 15.01.2026.'
		});
		expect(
			list.filter((reminder) => reminder.kind === 'vacancy').map((reminder) => reminder.title)
		).toEqual([
			expect.stringMatching(/^Mietvertrag anlegen: /),
			expect.stringMatching(/^Mietvertrag anlegen: /),
			expect.stringMatching(/^Mietvertrag anlegen: /),
			expect.stringMatching(/^Mietvertrag anlegen: /),
			expect.stringMatching(/^Mietvertrag anlegen: /),
			'1\u00a0weitere Einheit ohne Mietvertrag'
		]);
	});
});

describe('fristen', () => {
	it('lists the deadlines of the next twelve months', async () => {
		const { unitId } = await seedUnit(db, 'a');
		await seedLease(db, 'a', unitId, { startDate: '2025-01-01', endDate: '2026-06-30' });
		expect(await run(loadDeadlines)).toMatchObject({
			data: {
				today: '2026-03-10',
				deadlines: expect.arrayContaining([
					expect.objectContaining({ kind: 'lease_end', date: '2026-06-30' })
				])
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
				stats: { arrearsCount: 1 }
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
				hosted: false,
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
