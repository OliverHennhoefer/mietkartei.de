import { findHeaderRow, parseCsv, toRecords } from '../csv';
import { parseGermanDate, type IsoDate } from '../dates';
import { parseCents } from '../money';
import type { MatchingField } from '../server/db/schema';

// Bank import and matching without a database: which columns of a bank's CSV export mean what
// (presets), how a record becomes a transaction, the fingerprint that keeps a re-imported file
// from adding anything, and which lease a transaction most likely belongs to. Everything here is
// pure, so the specs check each preset against a fixture string.

/** One statement line as the import stores it. Amount in signed cents, incoming positive. */
export type BankRow = {
	bookingDate: IsoDate;
	valueDate: IsoDate | null;
	amount: number;
	counterpartName: string;
	counterpartIban: string | null;
	purpose: string;
	externalId: string | null;
};

/** Which column of the file holds which field. Null = the file has no such column. */
export type ColumnMapping = {
	bookingDate: string;
	valueDate: string | null;
	amount: string;
	counterpartName: string | null;
	/** DKB lists payer and payee apart; outgoing amounts take the counterpart from here. */
	counterpartNameOutgoing?: string | null;
	counterpartIban: string | null;
	purpose: string | null;
	externalId?: string | null;
	/** comdirect writes "Auftraggeber: … Buchungstext: …" into one column; split it. */
	textFormat?: 'comdirect';
};

export type BankPreset = {
	id: string;
	name: string;
	/** Column names the header row must carry (case-insensitive, trimmed). */
	required: string[];
	mapping: ColumnMapping;
	/** Rows with this value in the column are left out, e.g. DKB's "Vorgemerkt". */
	skip?: { column: string; value: string; reason: string };
};

export const GENERIC_PRESET_ID = 'generic';

/** The exports this import understands without a column mapping; the first match wins. */
const bankPresets: readonly BankPreset[] = [
	{
		id: 'sparkasse-camt',
		name: 'Sparkasse (CSV-CAMT)',
		required: [
			'Buchungstag',
			'Valutadatum',
			'Verwendungszweck',
			'Beguenstigter/Zahlungspflichtiger',
			'Kontonummer/IBAN',
			'Betrag'
		],
		mapping: {
			bookingDate: 'Buchungstag',
			valueDate: 'Valutadatum',
			amount: 'Betrag',
			counterpartName: 'Beguenstigter/Zahlungspflichtiger',
			counterpartIban: 'Kontonummer/IBAN',
			purpose: 'Verwendungszweck'
		}
	},
	{
		id: 'sparkasse-mt940',
		name: 'Sparkasse (CSV-MT940)',
		required: [
			'Buchungstag',
			'Valutadatum',
			'Verwendungszweck',
			'Beguenstigter/Zahlungspflichtiger',
			'Kontonummer',
			'BLZ',
			'Betrag'
		],
		mapping: {
			bookingDate: 'Buchungstag',
			valueDate: 'Valutadatum',
			amount: 'Betrag',
			counterpartName: 'Beguenstigter/Zahlungspflichtiger',
			counterpartIban: 'Kontonummer',
			purpose: 'Verwendungszweck'
		}
	},
	{
		id: 'volksbank',
		name: 'Volksbank / Raiffeisenbank',
		required: [
			'Buchungstag',
			'Valuta',
			'Name Zahlungsbeteiligter',
			'IBAN Zahlungsbeteiligter',
			'Verwendungszweck',
			'Betrag'
		],
		mapping: {
			bookingDate: 'Buchungstag',
			valueDate: 'Valuta',
			amount: 'Betrag',
			counterpartName: 'Name Zahlungsbeteiligter',
			counterpartIban: 'IBAN Zahlungsbeteiligter',
			purpose: 'Verwendungszweck'
		}
	},
	{
		id: 'ing',
		name: 'ING',
		required: ['Buchung', 'Valuta', 'Auftraggeber/Empfänger', 'Verwendungszweck', 'Betrag'],
		mapping: {
			bookingDate: 'Buchung',
			valueDate: 'Valuta',
			amount: 'Betrag',
			counterpartName: 'Auftraggeber/Empfänger',
			counterpartIban: null,
			purpose: 'Verwendungszweck'
		}
	},
	{
		id: 'dkb',
		name: 'DKB',
		required: [
			'Buchungsdatum',
			'Wertstellung',
			'Zahlungspflichtige*r',
			'Zahlungsempfänger*in',
			'Verwendungszweck',
			'IBAN',
			'Betrag (€)'
		],
		mapping: {
			bookingDate: 'Buchungsdatum',
			valueDate: 'Wertstellung',
			amount: 'Betrag (€)',
			counterpartName: 'Zahlungspflichtige*r',
			counterpartNameOutgoing: 'Zahlungsempfänger*in',
			counterpartIban: 'IBAN',
			purpose: 'Verwendungszweck'
		},
		skip: { column: 'Status', value: 'Vorgemerkt', reason: 'Noch nicht gebucht (vorgemerkt)' }
	},
	{
		id: 'comdirect',
		name: 'comdirect',
		required: ['Buchungstag', 'Wertstellung (Valuta)', 'Vorgang', 'Buchungstext', 'Umsatz in EUR'],
		mapping: {
			bookingDate: 'Buchungstag',
			valueDate: 'Wertstellung (Valuta)',
			amount: 'Umsatz in EUR',
			counterpartName: null,
			counterpartIban: null,
			purpose: 'Buchungstext',
			textFormat: 'comdirect'
		}
	}
];

/** The preset whose required columns a row of the file carries, with that header row's index. */
export function detectPreset(
	rows: string[][]
): { preset: BankPreset; headerIndex: number } | undefined {
	for (const preset of bankPresets) {
		const headerIndex = findHeaderRow(rows, preset.required);
		if (headerIndex >= 0) return { preset, headerIndex };
	}
	return undefined;
}

/**
 * The header row of a file without a known preset: the first row as wide as the widest row,
 * which skips the short preamble lines some banks write above the table. -1 for an empty file.
 */
export function genericHeaderRow(rows: string[][]): number {
	const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
	if (width < 2) return -1;
	return rows.findIndex((row) => row.length === width);
}

/** The fields a generic file maps by hand, in the order the import page shows them. */
export type GenericField =
	'bookingDate' | 'valueDate' | 'amount' | 'counterpartName' | 'counterpartIban' | 'purpose';

/** Column names that mean a field, lower case; earlier names win over later ones. */
const genericSynonyms: Record<GenericField, readonly string[]> = {
	bookingDate: ['buchungstag', 'buchungsdatum', 'buchung', 'datum', 'date', 'booking date'],
	valueDate: ['valuta', 'valutadatum', 'wertstellung', 'wertstellungsdatum', 'value date'],
	amount: ['betrag', 'betrag (eur)', 'betrag (€)', 'betrag in eur', 'umsatz', 'amount'],
	counterpartName: [
		'name',
		'gegenseite',
		'name der gegenseite',
		'auftraggeber/empfänger',
		'empfänger',
		'zahlungsempfänger',
		'auftraggeber',
		'begünstigter',
		'name zahlungsbeteiligter'
	],
	counterpartIban: ['iban', 'iban der gegenseite', 'iban zahlungsbeteiligter', 'kontonummer/iban'],
	purpose: ['verwendungszweck', 'zweck', 'buchungstext', 'text', 'beschreibung', 'purpose']
};

/**
 * A first mapping for a generic file from its column names, so a file headed "Datum; Name;
 * Verwendungszweck; Betrag" needs no selects at all. Each field takes the first unused column
 * that is one of its names; '' where none is. The landlord can still change every select.
 */
export function proposeGenericMapping(columns: readonly string[]): Record<GenericField, string> {
	const normalized = columns.map((column) => column.trim().toLowerCase());
	const used = new Set<number>();
	const mapping = {} as Record<GenericField, string>;
	for (const field of Object.keys(genericSynonyms) as GenericField[]) {
		mapping[field] = '';
		for (const synonym of genericSynonyms[field]) {
			const index = normalized.findIndex((name, at) => !used.has(at) && name === synonym);
			if (index < 0) continue;
			mapping[field] = columns[index];
			used.add(index);
			break;
		}
	}
	return mapping;
}

export type ParsedBankFile = {
	/** The column names of the header row, for the mapping selects of a generic file. */
	columns: string[];
	/** The preset detected from the header (or camt); undefined for a file that needs a mapping. */
	preset: Pick<BankPreset, 'id' | 'name'> | undefined;
	/** Empty for a generic file until a mapping is given. */
	results: RowResult[];
};

/**
 * The decoded text of an export → its rows as transactions. A known header selects the preset;
 * otherwise the widest row is the header and `generic` says which of its columns mean what.
 * Undefined when the file has no table at all.
 */
export function parseBankFile(
	text: string,
	generic?: ColumnMapping | null
): ParsedBankFile | undefined {
	const rows = parseCsv(text);
	const detected = detectPreset(rows);
	if (detected) {
		const { preset, headerIndex } = detected;
		// The header matched case-insensitively; spell its columns as the preset does, so the
		// mapping's exact-key lookups find them (`BUCHUNGSTAG` → `Buchungstag`).
		const names = [...Object.values(preset.mapping), preset.skip?.column];
		const spelling = new Map(
			names.filter((name): name is string => !!name).map((name) => [name.toLowerCase(), name])
		);
		const header = rows[headerIndex].map(
			(cell) =>
				spelling.get(
					cell
						.replace(/^\ufeff/, '')
						.trim()
						.toLowerCase()
				) ?? cell
		);
		return {
			columns: rows[headerIndex],
			preset,
			results: mapRecords(
				toRecords([header, ...rows.slice(headerIndex + 1)], 0),
				preset.mapping,
				preset.skip
			)
		};
	}
	const headerIndex = genericHeaderRow(rows);
	if (headerIndex < 0) return undefined;
	const columns = rows[headerIndex]
		.map((cell) => cell.replace(/^\ufeff/, '').trim())
		.filter((cell) => cell !== '');
	return {
		columns,
		preset: undefined,
		results: generic ? mapRecords(toRecords(rows, headerIndex), generic) : []
	};
}

/** Whitespace runs become one space; the fields compare and hash in this form. */
export function normalizeText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/** `de12 5001 0517 5407 3249 31` → `DE12500105175407324931`; null when empty. */
export function normalizeIban(value: string | null | undefined): string | null {
	const iban = (value ?? '').replace(/\s+/g, '').toUpperCase();
	return iban === '' ? null : iban;
}

/** `DE12500105175407324931` → `DE12 5001 0517 5407 3249 31`, for pages. */
export function formatIban(iban: string): string {
	return (normalizeIban(iban) ?? '').replace(/(.{4})(?=.)/g, '$1 ');
}

/** comdirect: "Auftraggeber: Max Müller Buchungstext: Miete Oktober Ref. 123" → both parts. */
export function splitComdirectText(text: string): { counterpartName: string; purpose: string } {
	const match = /^(?:Auftraggeber|Empfänger|Empfaenger):\s*(.*?)\s*Buchungstext:\s*(.*)$/s.exec(
		normalizeText(text)
	);
	if (!match) return { counterpartName: '', purpose: normalizeText(text) };
	return {
		counterpartName: normalizeText(match[1]),
		purpose: normalizeText(match[2].replace(/\s*Ref\.\s*\S+$/, ''))
	};
}

export type RowResult = { ok: true; row: BankRow } | { ok: false; reason: string };

/** One record of the file → a transaction, or the German reason why it is not one. */
export function mapRecord(record: Record<string, string>, mapping: ColumnMapping): RowResult {
	const cell = (column: string | null | undefined) => (column ? (record[column] ?? '') : '');

	const bookingDate = parseGermanDate(cell(mapping.bookingDate));
	if (!bookingDate) return { ok: false, reason: `Ungültiges Datum „${cell(mapping.bookingDate)}“` };
	const valueText = cell(mapping.valueDate);
	const valueDate = valueText ? (parseGermanDate(valueText) ?? null) : null;
	const amount = parseCents(cell(mapping.amount));
	if (amount === undefined) {
		return { ok: false, reason: `Ungültiger Betrag „${cell(mapping.amount)}“` };
	}

	let counterpartName = normalizeText(cell(mapping.counterpartName));
	if (amount < 0 && mapping.counterpartNameOutgoing) {
		counterpartName = normalizeText(cell(mapping.counterpartNameOutgoing));
	}
	let purpose = normalizeText(cell(mapping.purpose));
	if (mapping.textFormat === 'comdirect') {
		const parts = splitComdirectText(cell(mapping.purpose));
		counterpartName = counterpartName || parts.counterpartName;
		purpose = parts.purpose;
	}
	const externalId = normalizeText(cell(mapping.externalId)) || null;

	return {
		ok: true,
		row: {
			bookingDate,
			valueDate,
			amount,
			counterpartName,
			counterpartIban: normalizeIban(cell(mapping.counterpartIban)),
			purpose,
			externalId
		}
	};
}

/** Every record of the file in order; a skipped row (DKB "Vorgemerkt") is reported like an invalid one. */
export function mapRecords(
	records: Record<string, string>[],
	mapping: ColumnMapping,
	skip?: BankPreset['skip']
): RowResult[] {
	return records.map((record) => {
		if (skip && normalizeText(record[skip.column] ?? '') === skip.value) {
			return { ok: false, reason: skip.reason };
		}
		return mapRecord(record, mapping);
	});
}

/** The text the fingerprint hashes: the normalized fields and the occurrence, pipe-separated. */
export function fingerprintInput(row: BankRow, occurrence: number): string {
	return [
		row.bookingDate,
		String(row.amount),
		normalizeText(row.counterpartName),
		row.counterpartIban ?? '',
		normalizeText(row.purpose),
		String(occurrence)
	].join('|');
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type FingerprintedRow = BankRow & { occurrence: number; fingerprint: string };

/**
 * Numbers identical lines within one file 0, 1, 2 … and hashes each row with its number, so a
 * tenant paying twice on one day keeps both lines while a re-import of the file adds nothing.
 */
export async function fingerprintRows(rows: BankRow[]): Promise<FingerprintedRow[]> {
	const seen = new Map<string, number>();
	return Promise.all(
		rows.map(async (row) => {
			const key = fingerprintInput(row, 0);
			const occurrence = seen.get(key) ?? 0;
			seen.set(key, occurrence + 1);
			return {
				...row,
				occurrence,
				fingerprint: await sha256Hex(fingerprintInput(row, occurrence))
			};
		})
	);
}

// Base64 for the hidden field that carries the file from the preview to the commit; btoa/atob
// exist on Node and on Workers, Buffer only on Node.

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

// Matching

export const matchingFieldLabels: Record<MatchingField, string> = {
	counterpartIban: 'IBAN der Gegenseite',
	counterpartName: 'Name der Gegenseite',
	purpose: 'Verwendungszweck'
};

/** The fields a rule may test, in the order the selects list them; the schema's list, client-safe. */
export const matchingFieldIds = Object.keys(matchingFieldLabels) as MatchingField[];

export type Rule = {
	id: string;
	leaseId: string;
	field: MatchingField;
	pattern: string;
	confirmed: boolean;
};

type Matchable = Pick<BankRow, 'amount' | 'counterpartName' | 'counterpartIban' | 'purpose'>;

/** Whether the rule's field contains its pattern, case-insensitively (IBANs without spaces). */
export function ruleMatches(
	rule: Pick<Rule, 'field' | 'pattern'>,
	transaction: Matchable
): boolean {
	if (rule.field === 'counterpartIban') {
		const pattern = normalizeIban(rule.pattern);
		return (
			!!pattern && !!transaction.counterpartIban && transaction.counterpartIban.includes(pattern)
		);
	}
	const pattern = normalizeText(rule.pattern).toLowerCase();
	if (!pattern) return false;
	return normalizeText(transaction[rule.field]).toLowerCase().includes(pattern);
}

/** The lease a confirmed rule assigns an incoming amount to on import; first rule wins. */
export function applyRules(rules: readonly Rule[], transaction: Matchable): string | undefined {
	if (transaction.amount <= 0) return undefined;
	return rules.find((rule) => rule.confirmed && ruleMatches(rule, transaction))?.leaseId;
}

export type SuggestionSource = 'rule' | 'iban' | 'name' | 'unit';

export type LeaseHints = {
	id: string;
	/** Tenant last names of the lease. */
	lastNames: string[];
	/** The main unit and the extra units. */
	unitNames: string[];
};

/**
 * The lease an open transaction most likely belongs to: a rule (unconfirmed ones too, in creation
 * order), the IBAN of an earlier assignment, then a tenant's last name or a unit name contained in
 * counterpart or purpose. Names shorter than three characters are not searched for.
 */
export function suggestLease(
	transaction: Matchable,
	context: {
		rules: readonly Rule[];
		leaseByIban: ReadonlyMap<string, string>;
		leases: readonly LeaseHints[];
	}
): { leaseId: string; source: SuggestionSource } | undefined {
	const rule = context.rules.find((candidate) => ruleMatches(candidate, transaction));
	if (rule) return { leaseId: rule.leaseId, source: 'rule' };

	const byIban =
		transaction.counterpartIban && context.leaseByIban.get(transaction.counterpartIban);
	if (byIban) return { leaseId: byIban, source: 'iban' };

	const haystack = normalizeText(
		`${transaction.counterpartName} ${transaction.purpose}`
	).toLowerCase();
	const contains = (name: string) => {
		const needle = normalizeText(name).toLowerCase();
		return needle.length >= 3 && haystack.includes(needle);
	};
	for (const lease of context.leases) {
		if (lease.lastNames.some(contains)) return { leaseId: lease.id, source: 'name' };
	}
	for (const lease of context.leases) {
		if (lease.unitNames.some(contains)) return { leaseId: lease.id, source: 'unit' };
	}
	return undefined;
}

/** The rule an assignment remembers: on the IBAN when the transaction has one, else the name. */
export function rememberedRule(
	transaction: Pick<BankRow, 'counterpartName' | 'counterpartIban'>
): { field: MatchingField; pattern: string } | undefined {
	if (transaction.counterpartIban)
		return { field: 'counterpartIban', pattern: transaction.counterpartIban };
	const name = normalizeText(transaction.counterpartName);
	return name ? { field: 'counterpartName', pattern: name } : undefined;
}

export type RememberStep =
	| { kind: 'create'; field: MatchingField; pattern: string }
	| { kind: 'unconfirm'; ruleIds: string[] };

/**
 * What assigning an incoming transaction to one lease as rent does to the rules: it remembers
 * the counterpart with a confirmed rule, so the next transfer assigns on import. A counterpart
 * that pays for more than one lease (the Jobcenter, parents with two flats) must not assign on
 * its own: when the landlord picks another lease than a confirmed rule says, that rule drops
 * back to a suggestion, and a counterpart whose money went to another lease before gets no rule.
 * Undefined when nothing changes, also when a rule for the lease already matches.
 */
export function rememberStep(
	transaction: Matchable,
	leaseId: string,
	context: { rules: readonly Rule[]; earlierLeaseIds: readonly string[] }
): RememberStep | undefined {
	if (transaction.amount <= 0) return undefined;
	const matching = context.rules.filter((rule) => ruleMatches(rule, transaction));
	const conflicting = matching.filter((rule) => rule.confirmed && rule.leaseId !== leaseId);
	if (conflicting.length) return { kind: 'unconfirm', ruleIds: conflicting.map((rule) => rule.id) };
	if (matching.length) return undefined;
	if (context.earlierLeaseIds.some((id) => id !== leaseId)) return undefined;
	const rule = rememberedRule(transaction);
	return rule && { kind: 'create', ...rule };
}
