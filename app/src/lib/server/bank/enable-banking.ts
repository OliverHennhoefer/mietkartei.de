import {
	ENABLE_BANKING_API_BASE,
	ENABLE_BANKING_APP_ID,
	ENABLE_BANKING_PRIVATE_KEY
} from '$app/env/private';
import { normalizeIban, normalizeText, type RowResult } from '../../domain/bank-matching';
import type { IsoDate } from '../../dates';

// A minimal client of the Enable Banking API (api.enablebanking.com), which holds the PSD2
// licence and fetches account statements from the banks: the landlord authorizes the access at
// their bank, and the app reads the booked transactions with the session that comes back. Every
// call is signed with a JWT of the application's RSA key. No SDK, so the same code runs on node
// and on Workers. ENABLE_BANKING_API_BASE points the tests at a fake.

export function bankSyncEnabled(): boolean {
	return Boolean(ENABLE_BANKING_APP_ID && ENABLE_BANKING_PRIVATE_KEY);
}

export class EnableBankingError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'EnableBankingError';
	}
}

function base64Url(bytes: Uint8Array | string): string {
	const binary =
		typeof bytes === 'string'
			? bytes
			: Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The DER bytes of a PKCS#8 PEM key ("-----BEGIN PRIVATE KEY-----"). */
function pemBytes(pem: string): Uint8Array<ArrayBuffer> {
	const body = pem
		.replace(/\\n/g, '\n')
		.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
		.replace(/\s+/g, '');
	return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

let cachedKey: { pem: string; key: Promise<CryptoKey> } | undefined;

function signingKey(pem: string): Promise<CryptoKey> {
	if (cachedKey?.pem !== pem) {
		cachedKey = {
			pem,
			key: crypto.subtle.importKey(
				'pkcs8',
				pemBytes(pem),
				{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
				false,
				['sign']
			)
		};
	}
	return cachedKey.key;
}

/** The bearer token of a call: RS256 with the application id as `kid`, valid for one hour. */
export async function applicationToken(
	appId: string,
	pem: string,
	nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> {
	const header = base64Url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }));
	const payload = base64Url(
		JSON.stringify({
			iss: 'enablebanking.com',
			aud: 'api.enablebanking.com',
			iat: nowSeconds,
			exp: nowSeconds + 3600
		})
	);
	const input = `${header}.${payload}`;
	const signature = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		await signingKey(pem),
		new TextEncoder().encode(input)
	);
	return `${input}.${base64Url(new Uint8Array(signature))}`;
}

async function call<T>(
	method: 'GET' | 'POST' | 'DELETE',
	path: string,
	body?: unknown
): Promise<T> {
	const token = await applicationToken(ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY);
	const response = await fetch(`${ENABLE_BANKING_API_BASE.replace(/\/$/, '')}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			...(body === undefined ? {} : { 'content-type': 'application/json' })
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const text = await response.text();
	if (!response.ok) {
		let message = `Enable Banking answered ${response.status}`;
		try {
			const parsed = JSON.parse(text) as { message?: string; error?: string };
			message = parsed.message ?? parsed.error ?? message;
		} catch {
			// Not JSON; keep the status.
		}
		throw new EnableBankingError(response.status, message);
	}
	return (text ? JSON.parse(text) : {}) as T;
}

export type Aspsp = {
	name: string;
	country: string;
	bic?: string | null;
	/** Seconds; how long the bank lets one authorization last. */
	maximum_consent_validity?: number | null;
};

/** The German banks that offer account information to private customers. */
export async function listAspsps(): Promise<Aspsp[]> {
	const answer = await call<{ aspsps?: Aspsp[] }>(
		'GET',
		'/aspsps?country=DE&psu_type=personal&service=AIS'
	);
	return answer.aspsps ?? [];
}

/** Starts an authorization at the bank; the landlord is sent to `url`. */
export async function startAuthorization(input: {
	aspsp: { name: string; country: string };
	validUntil: Date;
	state: string;
	redirectUrl: string;
}): Promise<{ url: string; authorization_id?: string }> {
	return call('POST', '/auth', {
		access: { valid_until: input.validUntil.toISOString() },
		aspsp: input.aspsp,
		state: input.state,
		redirect_url: input.redirectUrl,
		psu_type: 'personal',
		language: 'de'
	});
}

export type SessionAccount = {
	uid: string;
	account_id?: { iban?: string | null } | null;
};

export type BankSession = {
	session_id: string;
	accounts?: SessionAccount[];
	access?: { valid_until?: string } | null;
};

/** Exchanges the code of the bank's redirect for a session with the authorized accounts. */
export async function createSession(code: string): Promise<BankSession> {
	return call('POST', '/sessions', { code });
}

/** Ends a session and with it the access at the bank. */
export async function deleteSession(sessionId: string): Promise<void> {
	await call('DELETE', `/sessions/${encodeURIComponent(sessionId)}`);
}

type Party = { name?: string | null } | null | undefined;
type PartyAccount = { iban?: string | null } | null | undefined;

const MAX_PAGES = 50;

export type BankApiTransaction = {
	entry_reference?: string | null;
	transaction_id?: string | null;
	transaction_amount?: { amount?: string; currency?: string } | null;
	credit_debit_indicator?: 'CRDT' | 'DBIT' | string | null;
	status?: string | null;
	booking_date?: string | null;
	value_date?: string | null;
	creditor?: Party;
	creditor_account?: PartyAccount;
	debtor?: Party;
	debtor_account?: PartyAccount;
	remittance_information?: string[] | null;
};

/**
 * The booked transactions of an account from `dateFrom` on, all pages. A history longer than the
 * page limit throws instead of coming back incomplete.
 */
export async function listTransactions(
	accountUid: string,
	dateFrom: IsoDate
): Promise<BankApiTransaction[]> {
	const all: BankApiTransaction[] = [];
	let continuation: string | undefined;
	// A safety net against a bank that keeps handing out continuation keys.
	for (let page = 0; page < MAX_PAGES; page++) {
		const query = new URLSearchParams({ date_from: dateFrom, transaction_status: 'BOOK' });
		if (continuation) query.set('continuation_key', continuation);
		const answer = await call<{
			transactions?: BankApiTransaction[];
			continuation_key?: string | null;
		}>('GET', `/accounts/${encodeURIComponent(accountUid)}/transactions?${query}`);
		all.push(...(answer.transactions ?? []));
		continuation = answer.continuation_key ?? undefined;
		if (!continuation) return all;
	}
	throw new EnableBankingError(0, `Mehr als ${MAX_PAGES} Seiten Umsätze`);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "12.34" → 1234; undefined for anything else. */
function cents(amount: string | undefined): number | undefined {
	const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount?.trim() ?? '');
	if (!match) return undefined;
	return Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0'));
}

/**
 * A transaction of the API as a row of the bank import. Like camt.053, the counterpart is the
 * debtor of an incoming and the creditor of an outgoing amount.
 */
export function toRow(transaction: BankApiTransaction): RowResult {
	const bookingDate = transaction.booking_date ?? transaction.value_date ?? '';
	if (!ISO_DATE.test(bookingDate)) return { ok: false, reason: 'Umsatz ohne Buchungsdatum' };
	const currency = transaction.transaction_amount?.currency;
	if (currency && currency !== 'EUR') return { ok: false, reason: `Umsatz in ${currency}` };
	const value = cents(transaction.transaction_amount?.amount);
	if (value === undefined) return { ok: false, reason: 'Umsatz ohne gültigen Betrag' };
	const amount = transaction.credit_debit_indicator === 'DBIT' ? -value : value;
	const incoming = amount >= 0;
	const party = incoming ? transaction.debtor : transaction.creditor;
	const partyAccount = incoming ? transaction.debtor_account : transaction.creditor_account;
	const valueDate = transaction.value_date ?? null;
	return {
		ok: true,
		row: {
			bookingDate: bookingDate as IsoDate,
			valueDate: valueDate && ISO_DATE.test(valueDate) ? (valueDate as IsoDate) : null,
			amount,
			counterpartName: normalizeText(party?.name ?? ''),
			counterpartIban: normalizeIban(partyAccount?.iban),
			purpose: normalizeText((transaction.remittance_information ?? []).join(' ')),
			externalId: transaction.entry_reference || transaction.transaction_id || null
		}
	};
}
