import { unzipSync } from 'fflate';
import { decodeCsv } from '../csv';
import { isIsoDate, type IsoDate } from '../dates';
import { child, children, parseXml, textAt, XmlError, type XmlElement } from '../xml';
import {
	formatIban,
	normalizeIban,
	normalizeText,
	parseBankFile,
	type ColumnMapping,
	type ParsedBankFile,
	type RowResult
} from './bank-matching';

// camt.053, the ISO 20022 statement every German bank offers next to (and instead of) its CSV
// export: one file per statement, often several statements in a ZIP. The same reader takes
// camt.052 (intraday report) and camt.054 (notification), which carry the same entries. Versions
// 001.02 to 001.08+ differ in a few paths (`Sts`/`Sts/Cd`, `Dbtr/Nm`/`Dbtr/Pty/Nm`, the amount of
// a transaction), which the reader accepts side by side. Pure, so the specs check fixture strings.

/** The camt flavours by the root's first element, with the name the preview shows. */
const MESSAGES: Record<string, { container: string; name: string }> = {
	BkToCstmrStmt: { container: 'Stmt', name: 'camt.053 (XML-Kontoauszug)' },
	BkToCstmrAcctRpt: { container: 'Rpt', name: 'camt.052 (XML-Umsatzbericht)' },
	BkToCstmrDbtCdtNtfctn: { container: 'Ntfctn', name: 'camt.054 (XML-Buchungsmitteilung)' }
};

export const CAMT_PRESET_ID = 'camt';

/** The statement as rows; `accountIbans` names the statement's own account per row. */
export type ParsedCamt = {
	name: string;
	results: RowResult[];
	/** Parallel to `results`: the IBAN of the account the statement is for, null if it has none. */
	accountIbans: (string | null)[];
};

/** `850.00` → 85000; undefined for anything but a plain decimal with at most two places. */
export function parseCamtAmount(value: string): number | undefined {
	const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
	if (!match) return undefined;
	return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** `<BookgDt><Dt>` or `<DtTm>` (date and time; its date is the booking day). */
function camtDate(element: XmlElement | undefined): IsoDate | undefined {
	const value = (textAt(element, 'Dt') || textAt(element, 'DtTm')).slice(0, 10);
	return isIsoDate(value) ? value : undefined;
}

/** A party's name in either version: `<Dbtr><Nm>` (001.02) or `<Dbtr><Pty><Nm>` (001.08). */
function partyName(party: XmlElement | undefined): string {
	return normalizeText(textAt(party, 'Nm') || textAt(party, 'Pty', 'Nm'));
}

/** `<DbtrAcct><Id><IBAN>`; null without one (some banks write `<Othr>` for old account numbers). */
function accountIban(account: XmlElement | undefined): string | null {
	return normalizeIban(textAt(account, 'Id', 'IBAN'));
}

/** The amount of a transaction within a batch: `<Amt>` (001.04+) or `<AmtDtls><TxAmt><Amt>`. */
function transactionAmount(details: XmlElement): XmlElement | undefined {
	return child(details, 'Amt') ?? child(details, 'AmtDtls', 'TxAmt', 'Amt');
}

function signed(cents: number, indicator: string): number {
	return indicator === 'DBIT' ? -cents : cents;
}

/**
 * One row per transaction of the entry. A batch booking (several `TxDtls` whose amounts add up to
 * the entry) is split, so each tenant of a collective transfer is a line of its own; otherwise the
 * entry is one row with the details of its first transaction.
 */
function mapEntry(entry: XmlElement, currency: string): RowResult[] {
	const status = textAt(entry, 'Sts', 'Cd') || textAt(entry, 'Sts');
	if (status === 'PDNG') return [{ ok: false, reason: 'Noch nicht gebucht (vorgemerkt)' }];
	if (status && status !== 'BOOK')
		return [{ ok: false, reason: 'Nicht gebucht (nur Information)' }];

	const amountElement = child(entry, 'Amt');
	const amountText = amountElement?.text.trim() ?? '';
	const cents = parseCamtAmount(amountText);
	if (cents === undefined) return [{ ok: false, reason: `Ungültiger Betrag „${amountText}“` }];
	const entryCurrency = amountElement?.attributes.Ccy ?? currency;
	if (entryCurrency && entryCurrency !== 'EUR') {
		return [{ ok: false, reason: `Betrag in ${entryCurrency}, nur Euro wird importiert` }];
	}
	const indicator = textAt(entry, 'CdtDbtInd');
	const amount = signed(cents, indicator);

	const bookingDate = camtDate(child(entry, 'BookgDt'));
	if (!bookingDate) {
		const value = textAt(entry, 'BookgDt', 'Dt') || textAt(entry, 'BookgDt', 'DtTm');
		return [{ ok: false, reason: `Ungültiges Datum „${value}“` }];
	}
	const valueDate = camtDate(child(entry, 'ValDt')) ?? null;
	const entryReference = textAt(entry, 'AcctSvcrRef') || textAt(entry, 'NtryRef') || null;
	const entryText = normalizeText(textAt(entry, 'AddtlNtryInf'));

	const transactions = children(entry, 'NtryDtls').flatMap((group) => children(group, 'TxDtls'));

	const parts = transactions.map((transaction) => {
		const element = transactionAmount(transaction);
		const value = element ? parseCamtAmount(element.text) : undefined;
		const sameCurrency = !element?.attributes.Ccy || element.attributes.Ccy === entryCurrency;
		const partIndicator = textAt(transaction, 'CdtDbtInd') || indicator;
		return value === undefined || !sameCurrency ? undefined : signed(value, partIndicator);
	});
	const split =
		transactions.length > 1 &&
		parts.every((part) => part !== undefined) &&
		parts.reduce<number>((sum, part) => sum + part!, 0) === amount;

	const row = (transaction: XmlElement | undefined, rowAmount: number): RowResult => {
		const parties = child(transaction, 'RltdPties');
		// The counterpart is the debtor of an incoming and the creditor of an outgoing amount.
		const side = rowAmount < 0 ? 'Cdtr' : 'Dbtr';
		const counterpartName =
			partyName(child(parties, side)) || partyName(child(parties, `Ultmt${side}`));
		const purpose =
			normalizeText(
				children(child(transaction, 'RmtInf'), 'Ustrd')
					.map((line) => line.text)
					.join(' ')
			) ||
			normalizeText(textAt(transaction, 'AddtlTxInf')) ||
			entryText;
		return {
			ok: true,
			row: {
				bookingDate,
				valueDate,
				amount: rowAmount,
				counterpartName,
				counterpartIban: accountIban(child(parties, `${side}Acct`)),
				purpose,
				externalId: textAt(transaction, 'Refs', 'AcctSvcrRef') || entryReference
			}
		};
	};

	if (split) return transactions.map((transaction, index) => row(transaction, parts[index]!));
	return [row(transactions[0], amount)];
}

/**
 * The text of a camt file → its entries as rows, statement by statement. Undefined when the text
 * is not XML or not a camt message the import knows; throws nothing.
 */
export function parseCamt(text: string, seen: SeenEntries = new Map()): ParsedCamt | undefined {
	let root: XmlElement;
	try {
		root = parseXml(text);
	} catch (error) {
		if (error instanceof XmlError) return undefined;
		throw error;
	}
	const message = root.children.find((element) => element.name in MESSAGES);
	if (root.name !== 'Document' || !message) return undefined;
	const { container, name } = MESSAGES[message.name];

	const results: RowResult[] = [];
	const accountIbans: (string | null)[] = [];
	for (const statement of children(message, container)) {
		const account = child(statement, 'Acct');
		const iban = accountIban(account);
		const currency = textAt(account, 'Ccy');
		const statementId = textAt(statement, 'Id');
		const token = {};
		children(statement, 'Ntry').forEach((entry, position) => {
			const mapped = isRepeated(seen, token, entryKeys(iban, statementId, entry, position))
				? [{ ok: false, reason: 'Schon in einem anderen Auszug der Datei' } as const]
				: mapEntry(entry, currency);
			for (const result of mapped) {
				results.push(result);
				accountIbans.push(iban);
			}
		});
	}
	return { name, results, accountIbans };
}

/**
 * The entries an upload has read so far, by key, with the statement they came from. A ZIP may hold
 * the same statement twice or statements that overlap (intraday reports and the day's statement);
 * without this, the fingerprint would number the repeated entry as a second, legitimate payment.
 */
export type SeenEntries = Map<string, object>;

/** The bank's reference of the entry, and its place in a statement with an id. */
function entryKeys(
	iban: string | null,
	statementId: string,
	entry: XmlElement,
	position: number
): string[] {
	const keys: string[] = [];
	const reference = textAt(entry, 'AcctSvcrRef');
	if (reference && reference.toUpperCase() !== 'NONREF') keys.push(`${iban}|ref|${reference}`);
	if (statementId) keys.push(`${iban}|stmt|${statementId}|${position}`);
	return keys;
}

/** Whether another statement of the upload had one of the keys; records them for this one. */
function isRepeated(seen: SeenEntries, statement: object, keys: string[]): boolean {
	const repeated = keys.some((key) => {
		const owner = seen.get(key);
		return owner !== undefined && owner !== statement;
	});
	if (!repeated) for (const key of keys) seen.set(key, statement);
	return repeated;
}

/** Whether the decoded text is XML rather than a CSV table. */
export function looksLikeXml(text: string): boolean {
	return /^\ufeff?\s*</.test(text);
}

/** Local file header of a ZIP archive: `PK\x03\x04`. */
function isZip(bytes: Uint8Array): boolean {
	return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** What a ZIP of statements may unpack to; a year of daily camt files is a few megabytes. */
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;

/**
 * The XML files of a ZIP in name order (banks number the statements, so the order is the
 * booking order). Undefined when the archive cannot be read or would unpack too large.
 */
function unzipXml(bytes: Uint8Array): string[] | undefined {
	let total = 0;
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes, {
			filter: (file) => {
				if (!/\.xml$/i.test(file.name) || file.name.split('/').some((part) => part === '__MACOSX'))
					return false;
				total += file.originalSize;
				if (total > MAX_UNZIPPED_BYTES) throw new RangeError('zip too large');
				return true;
			}
		});
	} catch {
		return undefined;
	}
	return Object.keys(files)
		.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
		.map((name) => decodeCsv(files[name]));
}

/** The parsed upload, or the German sentence why it cannot be read. */
export type ParsedUpload =
	| { ok: true; file: ParsedBankFile; accountIbans: (string | null)[] | null }
	| { ok: false; reason: string };

function fromCamt(camt: ParsedCamt[]): ParsedUpload {
	return {
		ok: true,
		file: {
			columns: [],
			preset: { id: CAMT_PRESET_ID, name: camt[0].name },
			results: camt.flatMap((statement) => statement.results)
		},
		accountIbans: camt.flatMap((statement) => statement.accountIbans)
	};
}

/**
 * The uploaded bytes → rows: a ZIP of camt files, a camt file, or a CSV export (preset or the
 * `generic` mapping). `accountIbans` is set for camt, whose statements name their account.
 */
export function parseBankUpload(bytes: Uint8Array, generic?: ColumnMapping | null): ParsedUpload {
	if (isZip(bytes)) {
		const texts = unzipXml(bytes);
		if (!texts) return { ok: false, reason: 'Die ZIP-Datei lässt sich nicht entpacken.' };
		const seen: SeenEntries = new Map();
		const camt = texts.map((text) => parseCamt(text, seen));
		if (camt.length === 0 || camt.some((statement) => !statement)) {
			return { ok: false, reason: 'Die ZIP-Datei enthält nicht nur camt-Kontoauszüge (XML).' };
		}
		return fromCamt(camt as ParsedCamt[]);
	}
	const text = decodeCsv(bytes);
	if (looksLikeXml(text)) {
		const camt = parseCamt(text);
		if (!camt) return { ok: false, reason: 'Die XML-Datei ist kein lesbarer camt-Kontoauszug.' };
		return fromCamt([camt]);
	}
	const file = parseBankFile(text, generic);
	if (!file) return { ok: false, reason: 'Die Datei enthält keine Tabelle mit Spalten.' };
	return { ok: true, file, accountIbans: null };
}

/**
 * Rows of a statement for another account than the chosen bank account become invalid, so a ZIP
 * with the statements of several accounts imports only the chosen account's lines.
 */
export function restrictToAccount(
	results: RowResult[],
	accountIbans: (string | null)[] | null,
	iban: string
): RowResult[] {
	if (!accountIbans) return results;
	const own = normalizeIban(iban);
	return results.map((result, index) => {
		const statementIban = accountIbans[index];
		if (!result.ok || !statementIban || statementIban === own) return result;
		return { ok: false, reason: `Auszug eines anderen Kontos (${formatIban(statementIban)})` };
	});
}
