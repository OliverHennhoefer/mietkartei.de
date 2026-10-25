import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBankAccount } from '#lib/server/bank/accounts.ts';
import { listConnections } from '#lib/server/bank/sync.ts';
import type { Database } from '#lib/server/db/index.ts';
import { contextA, managerA, outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { load as loadCallback } from './abruf/+page.server';
import { actions as accountActions, load as loadAccounts } from './konten/+page.server';
import { actions as startActions, load as loadStart } from './konten/[id]/abruf/+page.server';

// The Bankabruf pages: picking the bank, coming back from it, and the column on the Konten tab.
// Enable Banking is a stubbed fetch that answers by "METHOD path".

const env = vi.hoisted(() => ({
	ENABLE_BANKING_APP_ID: 'app-unit',
	ENABLE_BANKING_PRIVATE_KEY: '',
	ENABLE_BANKING_API_BASE: 'http://enablebanking.test'
}));
vi.mock('$app/env/private', async (original) => ({
	...(await original<Record<string, unknown>>()),
	get ENABLE_BANKING_APP_ID() {
		return env.ENABLE_BANKING_APP_ID;
	},
	get ENABLE_BANKING_PRIVATE_KEY() {
		return env.ENABLE_BANKING_PRIVATE_KEY;
	},
	get ENABLE_BANKING_API_BASE() {
		return env.ENABLE_BANKING_API_BASE;
	}
}));

const IBAN = 'DE02120300000000202051';

let db: Database;
let bankAccountId: string;
let answers: Record<string, (body: unknown, url: URL) => { status?: number; body: unknown }>;
let calls: string[];

beforeAll(async () => {
	const pair = await crypto.subtle.generateKey(
		{
			name: 'RSASSA-PKCS1-v1_5',
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: 'SHA-256'
		},
		true,
		['sign', 'verify']
	);
	const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
	env.ENABLE_BANKING_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(der)))}\n-----END PRIVATE KEY-----`;
});

beforeEach(async () => {
	db = await testDatabase();
	const created = await createBankAccount(db, contextA, {
		name: 'Mietkonto',
		iban: IBAN,
		bic: null,
		holder: 'Oliver'
	});
	if (!created.ok) throw new Error('setup failed');
	bankAccountId = created.id;
	calls = [];
	answers = {
		'GET /aspsps': () => ({
			body: {
				aspsps: [
					{ name: 'Testbank', country: 'DE', bic: 'TESTDEFF' },
					{ name: 'Deutsche Kreditbank', country: 'DE', bic: 'BYLADEM1001' }
				]
			}
		}),
		'POST /auth': () => ({ body: { url: 'https://tilisy.enablebanking.com/auth?x=1' } }),
		'POST /sessions': () => ({
			body: {
				session_id: 'session-1',
				accounts: [{ uid: 'acc-1', account_id: { iban: IBAN } }],
				access: { valid_until: '2099-01-01T00:00:00Z' }
			}
		}),
		'DELETE /sessions/session-1': () => ({ body: {} }),
		'GET /accounts/acc-1/transactions': () => ({
			body: {
				transactions: [
					{
						entry_reference: 'ref-1',
						transaction_amount: { amount: '850.00', currency: 'EUR' },
						credit_debit_indicator: 'CRDT',
						booking_date: '2026-10-01',
						debtor: { name: 'Max Müller' },
						remittance_information: ['Miete Oktober']
					}
				]
			}
		})
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const parsed = new URL(url);
			const call = `${init.method} ${parsed.pathname}`;
			calls.push(call);
			const body = init.body ? JSON.parse(String(init.body)) : undefined;
			const answer = answers[call]?.(body, parsed) ?? { status: 500, body: {} };
			return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
		})
	);
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	env.ENABLE_BANKING_APP_ID = 'app-unit';
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, options)));
}

/** Picks the Testbank and comes back from it with a code. */
async function connect() {
	expect(
		await run(startActions.start, { params: { id: bankAccountId }, form: { bank: 'Testbank' } })
	).toEqual({ redirect: 'https://tilisy.enablebanking.com/auth?x=1' });
	const [row] = await listConnections(db, 'a');
	return run(loadCallback, { url: `/bank/abruf?state=${row.state}&code=code-1` });
}

describe('bank/konten/[id]/abruf', () => {
	it('lists the banks sorted and preselects the bank by BIC', async () => {
		const page = await run(loadStart, { params: { id: bankAccountId } });
		expect(page).toMatchObject({
			data: {
				bankAccount: { id: bankAccountId, iban: 'DE02 1203 0000 0000 2020 51' },
				banks: ['Deutsche Kreditbank', 'Testbank'],
				unavailable: false
			}
		});
		expect(await run(loadStart, { params: { id: 'missing' } })).toMatchObject({ error: 404 });
	});

	it('says when the list of banks is not available', async () => {
		answers['GET /aspsps'] = () => ({ status: 503, body: { message: 'Down' } });
		expect(await run(loadStart, { params: { id: bankAccountId } })).toMatchObject({
			data: { banks: [], selected: null, unavailable: true }
		});
		expect(
			await run(startActions.start, { params: { id: bankAccountId }, form: { bank: 'Testbank' } })
		).toMatchObject({ fail: 502 });
	});

	it('refuses a bank that is not in the list and an authorization outside https', async () => {
		expect(
			await run(startActions.start, { params: { id: bankAccountId }, form: { bank: 'Nobank' } })
		).toMatchObject({ fail: 400 });
		answers['POST /auth'] = () => ({ body: { url: 'http://tilisy.enablebanking.com/auth' } });
		expect(
			await run(startActions.start, { params: { id: bankAccountId }, form: { bank: 'Testbank' } })
		).toMatchObject({ fail: 502 });
		answers['POST /auth'] = () => ({ body: { url: 'not a url' } });
		expect(
			await run(startActions.start, { params: { id: bankAccountId }, form: { bank: 'Testbank' } })
		).toMatchObject({ fail: 502 });
	});

	it('is not there while the instance has no application', async () => {
		env.ENABLE_BANKING_APP_ID = '';
		expect(await run(loadStart, { params: { id: bankAccountId } })).toMatchObject({ error: 404 });
		expect(await run(loadCallback, { url: '/bank/abruf?state=x&code=y' })).toMatchObject({
			error: 404
		});
	});
});

describe('bank/abruf', () => {
	it('stores the session, fetches at once and goes back to the Konten tab', async () => {
		expect(await connect()).toEqual({ redirect: '/bank/konten?abruf=ok' });
		expect(calls).toContain('GET /accounts/acc-1/transactions');
		const page = (await run(loadAccounts, { url: '/bank/konten?abruf=ok' })) as {
			data: { sync: Record<string, { bank: string; active: boolean; lastSyncedAt: string }> };
		};
		expect(page.data.sync[bankAccountId]).toMatchObject({ bank: 'Testbank', active: true });
		expect(page.data.sync[bankAccountId].lastSyncedAt).toEqual(expect.any(String));
	});

	it('explains a refusal, a stale link, a missing IBAN and a failed session', async () => {
		expect(await run(loadCallback, { url: '/bank/abruf?error=access_denied' })).toMatchObject({
			data: { message: expect.stringContaining('nicht freigegeben') }
		});
		expect(await run(loadCallback, { url: '/bank/abruf?state=x&code=y' })).toMatchObject({
			data: { message: expect.stringContaining('nicht mehr gültig') }
		});

		answers['POST /sessions'] = () => ({ status: 400, body: { message: 'Bad code' } });
		await run(startActions.start, { params: { id: bankAccountId }, form: { bank: 'Testbank' } });
		const [row] = await listConnections(db, 'a');
		expect(await run(loadCallback, { url: `/bank/abruf?state=${row.state}&code=c` })).toMatchObject(
			{ data: { message: expect.stringContaining('nicht abgeschlossen') } }
		);

		answers['POST /sessions'] = () => ({
			body: { session_id: 'session-1', accounts: [{ uid: 'x', account_id: { iban: 'DE89' } }] }
		});
		expect(await run(loadCallback, { url: `/bank/abruf?state=${row.state}&code=c` })).toMatchObject(
			{ data: { message: expect.stringContaining('DE02 1203') } }
		);
	});
});

describe('bank/konten Bankabruf', () => {
	it('fetches now, and says when the bank does not deliver', async () => {
		expect(await run(accountActions.sync, { form: { id: bankAccountId } })).toMatchObject({
			fail: 400
		});
		await connect();
		expect(await run(accountActions.sync, { form: { id: bankAccountId } })).toEqual({
			data: { synced: { imported: 0, assigned: 0 } }
		});
		answers['GET /accounts/acc-1/transactions'] = () => ({ status: 503, body: {} });
		expect(await run(accountActions.sync, { form: { id: bankAccountId } })).toMatchObject({
			fail: 502
		});
	});

	it('ends the Bankabruf and keeps it while the bank does not', async () => {
		await connect();
		answers['DELETE /sessions/session-1'] = () => ({ status: 503, body: {} });
		expect(await run(accountActions.end, { form: { id: bankAccountId } })).toMatchObject({
			fail: 502
		});
		answers['DELETE /sessions/session-1'] = () => ({ body: {} });
		expect(await run(accountActions.end, { form: { id: bankAccountId } })).toEqual({
			data: { ended: true }
		});
		expect(await run(accountActions.end, { form: { id: bankAccountId } })).toMatchObject({
			error: 404
		});
	});

	it('ends the session at the bank with the bank account', async () => {
		await connect();
		calls = [];
		expect(await run(accountActions.delete, { form: { id: bankAccountId } })).toEqual({
			data: { deleted: true }
		});
		expect(calls).toContain('DELETE /sessions/session-1');
	});

	it('shows managers no Bankabruf and has none without an application', async () => {
		expect(await run(loadAccounts, { user: managerA })).toMatchObject({
			data: { ownerOnly: true, sync: null }
		});
		env.ENABLE_BANKING_APP_ID = '';
		expect(await run(loadAccounts)).toMatchObject({ data: { sync: null } });
		expect(await run(accountActions.sync, { form: { id: bankAccountId } })).toMatchObject({
			error: 404
		});
		expect(await run(accountActions.end, { form: { id: bankAccountId } })).toMatchObject({
			error: 404
		});
	});
});
