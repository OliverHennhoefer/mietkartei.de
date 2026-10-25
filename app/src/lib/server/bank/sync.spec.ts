import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db';
import { bankConnections, bankTransactions } from '../db/schema';
import { contextA, testDatabase } from '../testing';
import { createBankAccount } from './accounts';
import { applicationToken, toRow, type BankApiTransaction } from './enable-banking';
import {
	connectionActive,
	endConnection,
	finishConnection,
	listConnections,
	startConnection,
	syncConnection,
	syncDue
} from './sync';

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
const aspsp = { name: 'Testbank', country: 'DE', maximum_consent_validity: 15_552_000 };

let publicKey: CryptoKey;
let db: Database;
let bankAccountId: string;
/** Answers by "METHOD path"; every call is recorded the same way. */
let answers: Record<string, (body: unknown, url: URL) => { status?: number; body: unknown }>;
let calls: string[];
let tokens: string[];

function pem(der: ArrayBuffer): string {
	const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
	return `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;
}

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
	publicKey = pair.publicKey;
	env.ENABLE_BANKING_PRIVATE_KEY = pem(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
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
	tokens = [];
	answers = {
		'POST /auth': () => ({ body: { url: 'https://tilisy.enablebanking.com/auth?x=1' } }),
		'POST /sessions': () => ({
			body: {
				session_id: 'session-1',
				accounts: [
					{ uid: 'other', account_id: { iban: 'DE89370400440532013000' } },
					{ uid: 'acc-1', account_id: { iban: 'DE02 1203 0000 0000 2020 51' } }
				],
				access: { valid_until: '2030-01-01T00:00:00Z' }
			}
		}),
		'DELETE /sessions/session-1': () => ({ body: { message: 'OK' } }),
		'GET /accounts/acc-1/transactions': () => ({ body: { transactions: [rent()] } })
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const parsed = new URL(url);
			const call = `${init.method} ${parsed.pathname}`;
			calls.push(call);
			tokens.push(String((init.headers as Record<string, string>).authorization));
			const body = init.body ? JSON.parse(String(init.body)) : undefined;
			const answer = answers[call]?.(body, parsed) ?? { status: 500, body: {} };
			return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	env.ENABLE_BANKING_APP_ID = 'app-unit';
});

function rent(overrides: Partial<BankApiTransaction> = {}): BankApiTransaction {
	return {
		entry_reference: 'ref-1',
		transaction_amount: { amount: '850.00', currency: 'EUR' },
		credit_debit_indicator: 'CRDT',
		status: 'BOOK',
		booking_date: '2026-10-01',
		value_date: '2026-10-01',
		debtor: { name: 'Max  Müller' },
		debtor_account: { iban: 'DE89 3704 0044 0532 0130 00' },
		creditor: { name: 'Oliver' },
		remittance_information: ['Miete Oktober', 'EG links'],
		...overrides
	};
}

async function connect(): Promise<string> {
	await startConnection(db, contextA, bankAccountId, aspsp, 'https://app.mietkartei.de');
	const [row] = await listConnections(db, 'a');
	const outcome = await finishConnection(db, contextA, row.state!, 'code-1');
	expect(outcome).toEqual({ ok: true, bankAccountId });
	return row.id;
}

async function connection() {
	const [row] = await listConnections(db, 'a');
	return row;
}

async function transactions() {
	return db
		.select()
		.from(bankTransactions)
		.where(eq(bankTransactions.bankAccountId, bankAccountId));
}

describe('applicationToken', () => {
	it('signs a JWT with the application id as kid that the public key verifies', async () => {
		const token = await applicationToken('app-unit', env.ENABLE_BANKING_PRIVATE_KEY, 1_000);
		const [header, payload, signature] = token.split('.');
		const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
		expect(decode(header)).toEqual({ typ: 'JWT', alg: 'RS256', kid: 'app-unit' });
		expect(decode(payload)).toEqual({
			iss: 'enablebanking.com',
			aud: 'api.enablebanking.com',
			iat: 1_000,
			exp: 4_600
		});
		const bytes = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), (char) =>
			char.charCodeAt(0)
		);
		const valid = await crypto.subtle.verify(
			'RSASSA-PKCS1-v1_5',
			publicKey,
			bytes,
			new TextEncoder().encode(`${header}.${payload}`)
		);
		expect(valid).toBe(true);
	});
});

describe('toRow', () => {
	it('takes the debtor of an incoming and the creditor of an outgoing amount', () => {
		expect(toRow(rent())).toEqual({
			ok: true,
			row: {
				bookingDate: '2026-10-01',
				valueDate: '2026-10-01',
				amount: 85_000,
				counterpartName: 'Max Müller',
				counterpartIban: 'DE89370400440532013000',
				purpose: 'Miete Oktober EG links',
				externalId: 'ref-1'
			}
		});
		const outgoing = toRow(
			rent({
				credit_debit_indicator: 'DBIT',
				transaction_amount: { amount: '12.5', currency: 'EUR' },
				creditor: { name: 'Stadtwerke' },
				creditor_account: { iban: 'DE44500105175407324931' }
			})
		);
		expect(outgoing).toMatchObject({
			row: {
				amount: -1250,
				counterpartName: 'Stadtwerke',
				counterpartIban: 'DE44500105175407324931'
			}
		});
	});

	it('refuses rows without a date, with a broken amount or in another currency', () => {
		expect(toRow(rent({ booking_date: null, value_date: null }))).toMatchObject({ ok: false });
		expect(toRow(rent({ transaction_amount: { amount: '1,00', currency: 'EUR' } }))).toMatchObject({
			ok: false
		});
		expect(toRow(rent({ transaction_amount: { amount: '1.00', currency: 'USD' } }))).toEqual({
			ok: false,
			reason: 'Umsatz in USD'
		});
	});
});

describe('Bankabruf', () => {
	it('authorizes at the bank for at most 180 days and comes back to /bank/abruf', async () => {
		const sent: unknown[] = [];
		answers['POST /auth'] = (body) => {
			sent.push(body);
			return { body: { url: 'https://tilisy.enablebanking.com/auth?x=1' } };
		};
		const now = new Date('2026-10-25T10:00:00Z');
		const started = await startConnection(
			db,
			contextA,
			bankAccountId,
			{ ...aspsp, maximum_consent_validity: 400 * 86_400 },
			'https://app.mietkartei.de',
			now
		);
		expect(started).toEqual({ url: 'https://tilisy.enablebanking.com/auth?x=1' });
		const [row] = await listConnections(db, 'a');
		expect(sent).toEqual([
			{
				access: { valid_until: '2027-04-23T10:00:00.000Z' },
				aspsp: { name: 'Testbank', country: 'DE' },
				state: row.state,
				redirect_url: 'https://app.mietkartei.de/bank/abruf',
				psu_type: 'personal',
				language: 'de'
			}
		]);
		expect(tokens[0]).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
	});

	it('stores the session with the account of the IBAN and imports the first transactions', async () => {
		await connect();
		const row = await connection();
		expect(row).toMatchObject({ state: null, sessionId: 'session-1', accountUid: 'acc-1' });
		expect(connectionActive(row, new Date('2029-12-31T00:00:00Z'))).toBe(true);
		expect(connectionActive(row, new Date('2030-01-02T00:00:00Z'))).toBe(false);

		const now = new Date('2026-10-25T10:00:00Z');
		expect(await syncConnection(db, contextA, row, { now })).toEqual({ imported: 1, assigned: 0 });
		expect(await transactions()).toMatchObject([{ amount: 85_000, counterpartName: 'Max Müller' }]);
		expect(calls).toContain('GET /accounts/acc-1/transactions');
	});

	it('fetches again only after six hours, overlapping without duplicates', async () => {
		await connect();
		const first = new Date('2026-10-25T10:00:00Z');
		await syncConnection(db, contextA, await connection(), { now: first });

		const queries: URL[] = [];
		answers['GET /accounts/acc-1/transactions'] = (_, url) => {
			queries.push(url);
			return {
				body: {
					transactions: [rent(), rent({ entry_reference: 'ref-2', booking_date: '2026-10-24' })]
				}
			};
		};
		await syncDue(db, contextA, new Date('2026-10-25T12:00:00Z'));
		expect(queries).toHaveLength(0);

		await syncDue(db, contextA, new Date('2026-10-25T17:00:00Z'));
		expect(queries).toHaveLength(1);
		expect(queries[0].searchParams.get('date_from')).toBe('2026-10-11');
		expect(queries[0].searchParams.get('transaction_status')).toBe('BOOK');
		expect(await transactions()).toHaveLength(2);
	});

	it('follows the continuation key over every page', async () => {
		await connect();
		answers['GET /accounts/acc-1/transactions'] = (_, url) =>
			url.searchParams.get('continuation_key')
				? {
						body: { transactions: [rent({ entry_reference: 'ref-2', booking_date: '2026-10-02' })] }
					}
				: { body: { transactions: [rent()], continuation_key: 'next' } };
		await syncConnection(db, contextA, await connection(), { force: true });
		expect(await transactions()).toHaveLength(2);
	});

	it('refuses a session without the IBAN of the bank account and ends it', async () => {
		answers['POST /sessions'] = () => ({
			body: {
				session_id: 'session-1',
				accounts: [{ uid: 'x', account_id: { iban: 'DE89370400440532013000' } }]
			}
		});
		await startConnection(db, contextA, bankAccountId, aspsp, 'https://app.mietkartei.de');
		const outcome = await finishConnection(db, contextA, (await connection()).state!, 'code');
		expect(outcome).toEqual({ ok: false, reason: 'iban', iban: 'DE02 1203 0000 0000 2020 51' });
		expect(calls).toContain('DELETE /sessions/session-1');
		expect((await connection()).sessionId).toBeNull();
	});

	it('knows no state of another account', async () => {
		await startConnection(db, contextA, bankAccountId, aspsp, 'https://app.mietkartei.de');
		const state = (await connection()).state!;
		expect(await finishConnection(db, { ...contextA, accountId: 'b' }, state, 'code')).toEqual({
			ok: false,
			reason: 'unknown'
		});
		expect(calls).not.toContain('POST /sessions');
	});

	it('keeps why a fetch failed until one works', async () => {
		await connect();
		answers['GET /accounts/acc-1/transactions'] = () => ({
			status: 401,
			body: { message: 'Session expired' }
		});
		await expect(syncConnection(db, contextA, await connection(), { force: true })).rejects.toThrow(
			'Session expired'
		);
		expect((await connection()).lastError).toBe('Session expired');

		answers['GET /accounts/acc-1/transactions'] = () => ({ body: { transactions: [] } });
		await syncConnection(db, contextA, await connection(), { force: true });
		expect((await connection()).lastError).toBeNull();
	});

	it('starts again from the full history after a first fetch that failed', async () => {
		await connect();
		const queries: URL[] = [];
		answers['GET /accounts/acc-1/transactions'] = (_, url) => {
			queries.push(url);
			return { status: 503, body: { message: 'Bank down' } };
		};
		await syncDue(db, contextA, new Date('2026-10-25T10:00:00Z'));
		expect((await connection()).lastSyncedAt).toBeNull();

		answers['GET /accounts/acc-1/transactions'] = (_, url) => {
			queries.push(url);
			return { body: { transactions: [rent()] } };
		};
		await syncDue(db, contextA, new Date('2026-10-25T12:00:00Z'));
		expect(queries).toHaveLength(1);
		await syncDue(db, contextA, new Date('2026-10-25T17:00:00Z'));
		expect(queries).toHaveLength(2);
		expect(queries[1].searchParams.get('date_from')).toBe('2026-07-28');
		expect(await transactions()).toHaveLength(1);
	});

	it('refuses a history that does not end within the page limit', async () => {
		await connect();
		answers['GET /accounts/acc-1/transactions'] = () => ({
			body: { transactions: [rent()], continuation_key: 'again' }
		});
		await expect(syncConnection(db, contextA, await connection(), { force: true })).rejects.toThrow(
			'Mehr als 50 Seiten'
		);
		expect(await transactions()).toEqual([]);
		expect((await connection()).lastSyncedAt).toBeNull();
	});

	it('does nothing while the instance has no application', async () => {
		await connect();
		env.ENABLE_BANKING_APP_ID = '';
		calls = [];
		await syncDue(db, contextA, new Date('2027-01-01T00:00:00Z'));
		expect(await syncConnection(db, contextA, await connection(), { force: true })).toBeUndefined();
		expect(calls).toEqual([]);
	});

	it('ends the session at the bank when the Bankabruf ends', async () => {
		await connect();
		expect(await endConnection(db, contextA, bankAccountId)).toBe(true);
		expect(calls).toContain('DELETE /sessions/session-1');
		expect(await db.select().from(bankConnections)).toEqual([]);
		expect(await endConnection(db, contextA, bankAccountId)).toBe(false);
	});

	it('keeps the Bankabruf when the bank does not end the session', async () => {
		await connect();
		answers['DELETE /sessions/session-1'] = () => ({ status: 503, body: { message: 'Down' } });
		await expect(endConnection(db, contextA, bankAccountId)).rejects.toThrow('Down');
		expect(await listConnections(db, 'a')).toHaveLength(1);

		answers['DELETE /sessions/session-1'] = () => ({ status: 404, body: { message: 'Gone' } });
		expect(await endConnection(db, contextA, bankAccountId)).toBe(true);
		expect(await listConnections(db, 'a')).toEqual([]);
	});
});
