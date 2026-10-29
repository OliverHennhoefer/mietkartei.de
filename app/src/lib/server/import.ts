import { eq } from 'drizzle-orm';
import { findHeaderRow } from '../csv';
import { firstOfMonth, formatDate, monthOf, parseGermanDate, today, type IsoDate } from '../dates';
import { formDataOf } from '../forms/fields';
import { parseLease, parseOpeningBalance } from '../forms/leases';
import { parsePayment } from '../forms/ledger';
import { parseTenant } from '../forms/tenants';
import { formatCents } from '../money';
import type { UnitKind } from '../units';
import { parseProperty, parseUnit, type PropertyInput, type UnitInput } from '../validation';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { chunk, rowsPerStatement, runBatch } from './db/batch';
import {
	leaseTenants,
	leaseUnits,
	leases,
	payments,
	properties,
	rentCharges,
	tenants,
	units,
	type HeatingCostModel,
	type LeaseKind,
	type OperatingCostModel
} from './db/schema';
import { newChargeLeases, newLeaseStatements, termsOverlap, type LeaseInput } from './leases';
import { chargeSyncStatements, type PaymentInput } from './ledger';
import { assertQuota } from './quotas';
import type { TenantInput } from './tenants';

// The CSV data import (Datenübernahme): a landlord maps the columns of an export of the old
// software onto the fields of one kind of record, sees a preview with the validation result of
// every row, and commits the valid rows. The mapping proposal and the row validation are pure
// (planImport); only loadImportContext and commitImport touch the database. Rows are validated
// with the same parsers the forms use, so a tenant from a file is checked like one typed in.

export const importKinds = ['properties', 'tenants', 'leases', 'payments'] as const;
export type ImportKind = (typeof importKinds)[number];

export const importKindLabels: Record<ImportKind, string> = {
	properties: 'Objekte und Einheiten',
	tenants: 'Mieter',
	leases: 'Mietverträge',
	payments: 'Zahlungen'
};

export type ImportField = {
	name: string;
	label: string;
	/** A row without a value in this field is skipped. */
	required: boolean;
	/** Header names (lower case) that map to this field; the first match in this order wins. */
	synonyms: readonly string[];
	/** Shown in the help text: what the column should contain. */
	hint?: string;
};

const propertyField: ImportField = {
	name: 'propertyName',
	label: 'Objekt',
	required: true,
	synonyms: [
		'objekt',
		'haus',
		'gebäude',
		'objektname',
		'objektbezeichnung',
		'liegenschaft',
		'immobilie'
	]
};
const unitField: ImportField = {
	name: 'unitName',
	label: 'Einheit',
	required: true,
	synonyms: ['einheit', 'wohnung', 'mieteinheit', 'wohneinheit', 'einheitsbezeichnung', 'lage']
};
const streetSynonyms = ['straße', 'strasse', 'straße und hausnummer', 'adresse', 'anschrift'];
const postalCodeSynonyms = ['plz', 'postleitzahl'];
const citySynonyms = ['ort', 'stadt', 'wohnort'];
const notesField: ImportField = {
	name: 'notes',
	label: 'Notizen',
	required: false,
	synonyms: [
		'notizen',
		'notiz',
		'bemerkung',
		'bemerkungen',
		'anmerkung',
		'anmerkungen',
		'kommentar'
	]
};

/** The target fields of every kind, in the order the mapping form and the preview show them. */
export const importFields: Record<ImportKind, readonly ImportField[]> = {
	properties: [
		propertyField,
		{
			name: 'street',
			label: 'Straße',
			required: false,
			synonyms: streetSynonyms,
			hint: 'Straße und Hausnummer; Pflicht für neue Objekte'
		},
		{
			name: 'postalCode',
			label: 'PLZ',
			required: false,
			synonyms: postalCodeSynonyms,
			hint: 'Pflicht für neue Objekte'
		},
		{
			name: 'city',
			label: 'Ort',
			required: false,
			synonyms: citySynonyms,
			hint: 'Pflicht für neue Objekte'
		},
		unitField,
		{
			name: 'unitKind',
			label: 'Art',
			required: false,
			synonyms: ['art', 'typ', 'nutzung', 'nutzungsart', 'einheitsart'],
			hint: 'Wohnung, Gewerbe oder Stellplatz; leer = Wohnung'
		},
		{
			name: 'floorArea',
			label: 'Fläche',
			required: false,
			synonyms: [
				'fläche',
				'flaeche',
				'wohnfläche',
				'wohnflaeche',
				'fläche in m²',
				'qm',
				'm²',
				'größe'
			],
			hint: 'in m², z. B. 72,5'
		}
	],
	tenants: [
		{ name: 'salutation', label: 'Anrede', required: false, synonyms: ['anrede'] },
		{ name: 'firstName', label: 'Vorname', required: true, synonyms: ['vorname', 'vornamen'] },
		{
			name: 'lastName',
			label: 'Nachname',
			required: true,
			synonyms: ['nachname', 'name', 'familienname', 'nachnamen']
		},
		{
			name: 'email',
			label: 'E-Mail',
			required: false,
			synonyms: ['e-mail', 'email', 'e-mail-adresse', 'mail', 'e-mail adresse']
		},
		{
			name: 'phone',
			label: 'Telefon',
			required: false,
			synonyms: ['telefon', 'telefonnummer', 'tel', 'tel.', 'handy', 'mobil', 'mobilnummer']
		},
		{ name: 'street', label: 'Straße', required: false, synonyms: streetSynonyms },
		{ name: 'postalCode', label: 'PLZ', required: false, synonyms: postalCodeSynonyms },
		{ name: 'city', label: 'Ort', required: false, synonyms: citySynonyms },
		notesField
	],
	leases: [
		propertyField,
		unitField,
		{
			name: 'tenantNames',
			label: 'Mieter',
			required: true,
			synonyms: [
				'mieter',
				'mietername',
				'name',
				'nachname',
				'vertragspartner',
				'mieter (nachname, vorname)'
			],
			hint: '„Nachname, Vorname“ oder E-Mail-Adresse eines angelegten Mieters; mehrere mit „;“ getrennt'
		},
		{
			name: 'startDate',
			label: 'Beginn',
			required: true,
			synonyms: ['beginn', 'mietbeginn', 'vertragsbeginn', 'start', 'von', 'einzug'],
			hint: 'z. B. 01.01.2025'
		},
		{
			name: 'endDate',
			label: 'Ende',
			required: false,
			synonyms: ['ende', 'mietende', 'vertragsende', 'bis', 'auszug'],
			hint: 'leer, solange der Vertrag läuft'
		},
		{
			name: 'kind',
			label: 'Art',
			required: false,
			synonyms: ['art', 'vertragsart', 'nutzung', 'nutzungsart', 'typ'],
			hint: 'Wohnraum, Gewerbe oder Stellplatz; leer = nach der Einheit'
		},
		{
			name: 'baseRent',
			label: 'Kaltmiete',
			required: true,
			synonyms: [
				'kaltmiete',
				'nettokaltmiete',
				'netto-kaltmiete',
				'grundmiete',
				'nettomiete',
				'miete'
			],
			hint: 'z. B. 650,00'
		},
		{
			name: 'operatingCostPrepayment',
			label: 'Betriebskostenvorauszahlung',
			required: false,
			synonyms: [
				'nebenkosten',
				'betriebskosten',
				'betriebskostenvorauszahlung',
				'nebenkostenvorauszahlung',
				'bk',
				'nk',
				'bk-vorauszahlung',
				'nk-vorauszahlung',
				'vorauszahlung betriebskosten'
			]
		},
		{
			name: 'heatingCostPrepayment',
			label: 'Heizkostenvorauszahlung',
			required: false,
			synonyms: [
				'heizkosten',
				'heizkostenvorauszahlung',
				'hk',
				'hk-vorauszahlung',
				'vorauszahlung heizkosten'
			]
		},
		{
			name: 'securityDeposit',
			label: 'Kaution',
			required: false,
			synonyms: ['kaution', 'mietkaution', 'mietsicherheit']
		},
		{
			name: 'persons',
			label: 'Personen',
			required: false,
			synonyms: ['personen', 'personenzahl', 'personenanzahl', 'anzahl personen', 'bewohner'],
			hint: 'leer = 1'
		},
		{
			name: 'operatingCostModel',
			label: 'Betriebskosten-Modell',
			required: false,
			synonyms: [
				'betriebskostenmodell',
				'nebenkostenmodell',
				'bk-modell',
				'nk-modell',
				'betriebskosten-modell'
			],
			hint: 'Vorauszahlung, Pauschale oder inklusive; leer = Vorauszahlung'
		},
		{
			name: 'heatingCostModel',
			label: 'Heizkosten-Modell',
			required: false,
			synonyms: ['heizkostenmodell', 'hk-modell', 'heizkosten-modell'],
			hint: 'Vorauszahlung oder Pauschale; leer = Vorauszahlung'
		},
		{
			name: 'ledgerStart',
			label: 'Mietkonto ab',
			required: false,
			synonyms: ['mietkonto ab', 'mietkonto führen ab', 'mietkonto', 'kontobeginn', 'saldo ab'],
			hint: 'ab wann das Mietkonto geführt wird; leer = der laufende Monat bei älteren Verträgen'
		},
		{
			name: 'openingBalance',
			label: 'Anfangssaldo',
			required: false,
			synonyms: [
				'anfangssaldo',
				'saldo',
				'saldovortrag',
				'anfangsbestand',
				'rückstand',
				'offener betrag'
			],
			hint: 'Saldo am Beginn des Mietkontos: positiv = Rückstand, negativ = Guthaben'
		},
		notesField
	],
	payments: [
		propertyField,
		unitField,
		{
			name: 'tenantLastName',
			label: 'Mieter',
			required: false,
			synonyms: ['mieter', 'nachname', 'name', 'mietername', 'zahler', 'auftraggeber'],
			hint: 'Nachname; nur nötig, wenn mehrere Mietverträge zur Einheit passen'
		},
		{
			name: 'date',
			label: 'Datum',
			required: true,
			synonyms: [
				'datum',
				'buchungstag',
				'buchungsdatum',
				'zahlungsdatum',
				'valuta',
				'wertstellung',
				'zahltag',
				'buchung'
			],
			hint: 'z. B. 03.01.2025'
		},
		{
			name: 'amount',
			label: 'Betrag',
			required: true,
			synonyms: ['betrag', 'summe', 'zahlung', 'zahlbetrag', 'betrag (eur)', 'betrag in eur'],
			hint: 'z. B. 850,00; negativ für eine Rückzahlung'
		},
		{
			name: 'note',
			label: 'Verwendungszweck',
			required: false,
			synonyms: [
				'verwendungszweck',
				'zweck',
				'buchungstext',
				'text',
				'notiz',
				'bemerkung',
				'beschreibung',
				'betreff'
			]
		}
	]
};

/** Target field name → column index of the file, null = "nicht importieren". */
export type ColumnMapping = Record<string, number | null>;

export type MappingProposal = {
	/** The row of the file that holds the column names (0-based). */
	headerIndex: number;
	headers: string[];
	mapping: ColumnMapping;
};

/** Column names compare case-insensitively, trimmed, without a byte order mark. */
function normalizeHeader(name: string): string {
	return name
		.replace(/^\ufeff/, '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ');
}

/** `Kaltmiete (EUR)` starts with the synonym `kaltmiete`, followed by something that is not a letter. */
function startsWithWord(header: string, word: string): boolean {
	return header.startsWith(word) && !/[\p{L}\d]/u.test(header.charAt(word.length));
}

/** How many leading rows are searched for the header; bank and software exports have a few preamble lines. */
const HEADER_SEARCH_ROWS = 50;

/**
 * Finds the header row (the first row that holds a known column name of the kind, else row 0)
 * and proposes a mapping: every target field takes the first unused column whose name is one of
 * its synonyms, exact matches before matches like `Kaltmiete (EUR)`. A file whose headers match
 * nothing gets a mapping of all nulls, and the page shows "nicht importieren" everywhere.
 */
export function proposeMapping(kind: ImportKind, rows: readonly string[][]): MappingProposal {
	const fields = importFields[kind];
	const leading = rows.slice(0, HEADER_SEARCH_ROWS);
	let headerIndex = -1;
	for (const field of fields) {
		for (const synonym of field.synonyms) {
			const index = findHeaderRow(leading, [synonym]);
			if (index >= 0 && (headerIndex < 0 || index < headerIndex)) headerIndex = index;
		}
	}
	if (headerIndex < 0) headerIndex = 0;

	const headers = rows[headerIndex] ?? [];
	const normalized = headers.map(normalizeHeader);
	const used = new Set<number>();
	const mapping: ColumnMapping = Object.fromEntries(fields.map((field) => [field.name, null]));
	const passes: ((header: string, synonym: string) => boolean)[] = [
		(header, synonym) => header === synonym,
		startsWithWord
	];
	for (const matches of passes) {
		for (const field of fields) {
			if (mapping[field.name] !== null) continue;
			for (const synonym of field.synonyms) {
				const column = normalized.findIndex(
					(header, index) => !used.has(index) && matches(header, synonym)
				);
				if (column < 0) continue;
				mapping[field.name] = column;
				used.add(column);
				break;
			}
		}
	}
	return { headerIndex, headers, mapping };
}

/** The labels of the required fields of the kind that no column is mapped to; the commit refuses while any. */
export function unmappedRequiredFields(kind: ImportKind, mapping: ColumnMapping): string[] {
	return importFields[kind]
		.filter((field) => field.required && (mapping[field.name] ?? null) === null)
		.map((field) => field.label);
}

/** The result of validating one row of the file, for the preview and the summary. */
export type RowResult = {
	/** The 1-based line of the parsed file; the header is line headerIndex + 1. */
	row: number;
	/** The mapped values by field name, for the preview. */
	values: Record<string, string>;
	/** Why the row is skipped; undefined when it will be imported. */
	reason?: string;
};

export type NewProperty = { key: string; input: PropertyInput };
export type NewUnit = { property: { id: string } | { key: string }; input: UnitInput };
export type NewLease = {
	row: number;
	values: Record<string, string>;
	input: LeaseInput;
	/** Posted as an adjustment dated the ledger start; 0 = nothing posted. */
	openingBalance: number;
};

export type ImportPlan =
	| { kind: 'properties'; rows: RowResult[]; properties: NewProperty[]; units: NewUnit[] }
	| { kind: 'tenants'; rows: RowResult[]; tenants: TenantInput[] }
	| { kind: 'leases'; rows: RowResult[]; leases: NewLease[] }
	| { kind: 'payments'; rows: RowResult[]; payments: PaymentInput[] };

/** What tells two tenants of the same name apart: the e-mail address, else the postal address. */
type TenantIdentity = {
	firstName: string;
	lastName: string;
	email: string | null;
	street: string | null;
	postalCode: string | null;
	city: string | null;
};

/** What the account already has, as far as the import needs it to resolve and deduplicate rows. */
export type ImportContext = {
	properties: { id: string; name: string; street: string; postalCode: string; city: string }[];
	units: { id: string; propertyId: string; name: string; kind: UnitKind }[];
	tenants: ({ id: string } & TenantIdentity)[];
	leases: {
		id: string;
		unitId: string;
		startDate: IsoDate;
		endDate: IsoDate | null;
		tenantIds: string[];
		/** Extra units rented with the main unit. */
		extraUnitIds: string[];
	}[];
	payments: { leaseId: string; date: IsoDate; amount: number; note: string | null }[];
};

export const emptyImportContext: ImportContext = {
	properties: [],
	units: [],
	tenants: [],
	leases: [],
	payments: []
};

/** Loads only what the kind needs, in a fixed number of queries, all filtered by the account. */
export async function loadImportContext(
	db: Database,
	accountId: string,
	kind: ImportKind
): Promise<ImportContext> {
	const wantsProperties = kind !== 'tenants';
	const wantsTenants = kind !== 'properties';
	const wantsLeases = kind === 'leases' || kind === 'payments';
	const wantsPayments = kind === 'payments';
	const [
		propertyRows,
		unitRows,
		tenantRows,
		leaseRows,
		extraUnitRows,
		leaseTenantRows,
		paymentRows
	] = await Promise.all([
		wantsProperties
			? db
					.select({
						id: properties.id,
						name: properties.name,
						street: properties.street,
						postalCode: properties.postalCode,
						city: properties.city
					})
					.from(properties)
					.where(eq(properties.accountId, accountId))
			: [],
		wantsProperties
			? db
					.select({
						id: units.id,
						propertyId: units.propertyId,
						name: units.name,
						kind: units.kind
					})
					.from(units)
					.where(eq(units.accountId, accountId))
			: [],
		wantsTenants
			? db
					.select({
						id: tenants.id,
						firstName: tenants.firstName,
						lastName: tenants.lastName,
						email: tenants.email,
						street: tenants.street,
						postalCode: tenants.postalCode,
						city: tenants.city
					})
					.from(tenants)
					.where(eq(tenants.accountId, accountId))
			: [],
		wantsLeases
			? db
					.select({
						id: leases.id,
						unitId: leases.unitId,
						startDate: leases.startDate,
						endDate: leases.endDate
					})
					.from(leases)
					.where(eq(leases.accountId, accountId))
			: [],
		wantsLeases
			? db
					.select({ leaseId: leaseUnits.leaseId, unitId: leaseUnits.unitId })
					.from(leaseUnits)
					.where(eq(leaseUnits.accountId, accountId))
			: [],
		wantsPayments
			? db
					.select({ leaseId: leaseTenants.leaseId, tenantId: leaseTenants.tenantId })
					.from(leaseTenants)
					.innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
					.where(eq(tenants.accountId, accountId))
			: [],
		wantsPayments
			? db
					.select({
						leaseId: payments.leaseId,
						date: payments.date,
						amount: payments.amount,
						note: payments.note
					})
					.from(payments)
					.where(eq(payments.accountId, accountId))
			: []
	]);
	return {
		properties: propertyRows,
		units: unitRows,
		tenants: tenantRows,
		leases: leaseRows.map((lease) => ({
			...lease,
			tenantIds: leaseTenantRows
				.filter((row) => row.leaseId === lease.id)
				.map((row) => row.tenantId),
			extraUnitIds: extraUnitRows.filter((row) => row.leaseId === lease.id).map((row) => row.unitId)
		})),
		payments: paymentRows
	};
}

// Row validation

type DataRow = { row: number; values: Record<string, string> };

/** Names compare trimmed, case-insensitively and with collapsed whitespace. */
function norm(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Streets compare like names, without spaces and with „Str.“, „Str“ and „Strasse“ read as
 * „Straße“, so „Lindenstr. 4“ is the same street as „Lindenstraße 4“.
 */
function normStreet(value: string): string {
	return norm(value)
		.replace(/strasse/g, 'straße')
		.replace(/str\.?(?=\s|\d|$)/g, 'straße')
		.replace(/\s/g, '');
}

function labelsOf(kind: ImportKind): Record<string, string> {
	return Object.fromEntries(importFields[kind].map((field) => [field.name, field.label]));
}

const propertyLabels = { name: 'Objekt', street: 'Straße', postalCode: 'PLZ', city: 'Ort' };
const unitLabels = { name: 'Einheit', kind: 'Art', floorArea: 'Fläche' };
const tenantLabels = labelsOf('tenants');
const paymentLabels = labelsOf('payments');
const leaseLabels = {
	...labelsOf('leases'),
	unitId: 'Einheit',
	tenantIds: 'Mieter',
	rentModel: 'Mietmodell',
	rentDueDay: 'Fälligkeit',
	indexBaseMonth: 'Basismonat',
	indexBaseValue: 'Indexwert',
	terminatedAt: 'Kündigung',
	terminatedBy: 'Gekündigt durch'
};

/** "Kaltmiete: Bitte gib einen Betrag an." — the first error of a parser, named by its column. */
function firstError(errors: object, labels: Record<string, string>): string {
	const entry = Object.entries(errors).find(([, message]) => typeof message === 'string');
	if (!entry) return 'Die Zeile ist ungültig.';
	const [field, message] = entry;
	return `${labels[field] ?? field}: ${message}`;
}

const unitKindWords: Record<string, UnitKind> = {
	wohnung: 'apartment',
	wohnen: 'apartment',
	wohnraum: 'apartment',
	apartment: 'apartment',
	gewerbe: 'commercial',
	gewerbeeinheit: 'commercial',
	laden: 'commercial',
	büro: 'commercial',
	praxis: 'commercial',
	commercial: 'commercial',
	stellplatz: 'parking',
	garage: 'parking',
	tiefgarage: 'parking',
	'tg-stellplatz': 'parking',
	carport: 'parking',
	parking: 'parking'
};

const leaseKindWords: Record<string, LeaseKind> = {
	wohnraum: 'residential',
	wohnung: 'residential',
	wohnen: 'residential',
	residential: 'residential',
	gewerbe: 'commercial',
	commercial: 'commercial',
	stellplatz: 'parking',
	garage: 'parking',
	tiefgarage: 'parking',
	parking: 'parking'
};

const leaseKindOfUnit: Record<UnitKind, LeaseKind> = {
	apartment: 'residential',
	commercial: 'commercial',
	parking: 'parking'
};

const operatingCostModelWords: Record<string, OperatingCostModel> = {
	vorauszahlung: 'prepayment',
	vz: 'prepayment',
	prepayment: 'prepayment',
	pauschale: 'flat',
	flat: 'flat',
	inklusive: 'inclusive',
	inklusivmiete: 'inclusive',
	enthalten: 'inclusive',
	'in der miete enthalten': 'inclusive',
	inclusive: 'inclusive'
};

const heatingCostModelWords: Record<string, HeatingCostModel> = {
	vorauszahlung: 'prepayment',
	vz: 'prepayment',
	prepayment: 'prepayment',
	pauschale: 'flat',
	flat: 'flat'
};

/** A German word for an enum, or the raw value, which the parser then rejects with its own message. */
function word<T extends string>(words: Record<string, T>, value: string, fallback: T): string {
	if (!value) return fallback;
	return words[norm(value)] ?? value;
}

/** A German or ISO date as ISO, or the raw value so the parser reports it. */
function isoDate(value: string): string {
	if (!value) return '';
	return parseGermanDate(value) ?? value;
}

function isBlank(values: Record<string, string>): boolean {
	return Object.values(values).every((value) => value === '');
}

/** The mapped values of every row after the header, numbered by their line in the parsed file. */
function dataRows(
	rows: readonly string[][],
	headerIndex: number,
	mapping: ColumnMapping,
	fields: readonly ImportField[]
): DataRow[] {
	return rows.slice(headerIndex + 1).map((cells, index) => {
		const values: Record<string, string> = {};
		for (const field of fields) {
			const column = mapping[field.name];
			values[field.name] =
				column === null || column === undefined ? '' : (cells[column] ?? '').trim();
		}
		return { row: headerIndex + 2 + index, values };
	});
}

type ExistingProperty = ImportContext['properties'][number];

/**
 * The existing property a row of the properties import adds its unit to. The name alone picks
 * a property only when no address is given and exactly one property has that name; with an
 * address, only a property of that name at that address is reused, and none means a new
 * property (a second "Haus" at another address is another building). Two candidates are a
 * row error, never a guess.
 */
function matchProperty(
	context: ImportContext,
	values: Record<string, string>
): ExistingProperty | { reason: string } | undefined {
	const name = values.propertyName;
	const named = context.properties.filter((property) => norm(property.name) === norm(name));
	if (!values.street) {
		if (named.length > 1) {
			return {
				reason: `Das Objekt „${name}“ gibt es mehrmals; gib Straße, PLZ und Ort an, damit klar ist, welches gemeint ist.`
			};
		}
		return named[0];
	}
	const atAddress = named.filter(
		(property) =>
			normStreet(property.street) === normStreet(values.street) &&
			(!values.postalCode || property.postalCode.trim() === values.postalCode.trim()) &&
			(!values.city || norm(property.city) === norm(values.city))
	);
	if (atAddress.length > 1) {
		return {
			reason: `Das Objekt „${name}“ gibt es unter dieser Adresse mehrmals; benenne die Objekte eindeutig, damit klar ist, welches gemeint ist.`
		};
	}
	return atAddress[0];
}

function findUnit(context: ImportContext, propertyId: string, name: string) {
	return context.units.find(
		(unit) => unit.propertyId === propertyId && norm(unit.name) === norm(name)
	);
}

type Located = {
	property: ExistingProperty;
	unit: ImportContext['units'][number];
};

/**
 * The unit named by property and unit name, or the German reason why there is none. Lease and
 * payment rows carry no address, so when several properties share the name, the unit name has
 * to pick exactly one of them; otherwise the row is an error, never the first match.
 */
function locateUnit(
	context: ImportContext,
	propertyName: string,
	unitName: string
): Located | string {
	if (!propertyName) return 'Objekt: Bitte gib die Bezeichnung des Objekts an.';
	if (!unitName) return 'Einheit: Bitte gib die Bezeichnung der Einheit an.';
	const named = context.properties.filter((property) => norm(property.name) === norm(propertyName));
	if (named.length === 0) return `Das Objekt „${propertyName}“ gibt es nicht.`;
	const located = named.flatMap((property) => {
		const unit = findUnit(context, property.id, unitName);
		return unit ? [{ property, unit }] : [];
	});
	if (located.length === 1) return located[0];
	if (located.length === 0) {
		return named.length === 1
			? `Die Einheit „${unitName}“ gibt es in „${named[0].name}“ nicht.`
			: `Die Einheit „${unitName}“ gibt es in keinem der Objekte „${propertyName}“.`;
	}
	return `Das Objekt „${propertyName}“ mit der Einheit „${unitName}“ gibt es mehrmals; benenne die Objekte eindeutig, damit klar ist, welches gemeint ist.`;
}

/** E-mail addresses compare trimmed and case-insensitively. */
function normEmail(value: string | null): string {
	return (value ?? '').trim().toLowerCase();
}

/**
 * Two tenants are the same person when the names match and, if both have an e-mail address,
 * the addresses match; without one on either side the postal address decides. So two tenants
 * called "Max Mustermann" with different e-mail or postal addresses are two people.
 */
function sameTenant(a: TenantIdentity, b: TenantIdentity): boolean {
	if (norm(a.firstName) !== norm(b.firstName) || norm(a.lastName) !== norm(b.lastName)) {
		return false;
	}
	if (a.email && b.email) return normEmail(a.email) === normEmail(b.email);
	return (
		normStreet(a.street ?? '') === normStreet(b.street ?? '') &&
		(a.postalCode ?? '').trim() === (b.postalCode ?? '').trim() &&
		norm(a.city ?? '') === norm(b.city ?? '')
	);
}

/**
 * A tenant named as "Nachname, Vorname", by e-mail address, by full name "Vorname Nachname" or
 * by last name alone. A name that several tenants share is a row error that asks for the
 * e-mail address, which tells them apart as it does in the tenant import; never the first match.
 */
function findTenant(context: ImportContext, token: string): string | { reason: string } {
	const wanted = norm(token);
	let matches: ImportContext['tenants'];
	let byLastName = false;
	if (wanted.includes('@')) {
		matches = context.tenants.filter((tenant) => normEmail(tenant.email) === wanted);
	} else if (wanted.includes(',')) {
		const [lastName, firstName] = wanted.split(',').map((part) => part.trim());
		matches = context.tenants.filter(
			(tenant) => norm(tenant.lastName) === lastName && norm(tenant.firstName) === firstName
		);
	} else {
		matches = context.tenants.filter(
			(tenant) => norm(`${tenant.firstName} ${tenant.lastName}`) === wanted
		);
		if (matches.length === 0) {
			byLastName = true;
			matches = context.tenants.filter((tenant) => norm(tenant.lastName) === wanted);
		}
	}
	if (matches.length === 1) return matches[0].id;
	if (matches.length === 0) return { reason: `Den Mieter „${token}“ gibt es nicht.` };
	if (wanted.includes('@')) {
		return {
			reason: `Die E-Mail-Adresse „${token}“ haben mehrere Mieter; gib „Nachname, Vorname“ an.`
		};
	}
	if (byLastName) {
		return {
			reason: `Der Mieter „${token}“ ist nicht eindeutig; gib „Nachname, Vorname“ oder die E-Mail-Adresse an.`
		};
	}
	const emails = new Set(matches.map((tenant) => normEmail(tenant.email)));
	const distinct = !emails.has('') && emails.size === matches.length;
	return {
		reason: distinct
			? `Den Mieter „${token}“ gibt es mehrmals; gib statt des Namens die E-Mail-Adresse an.`
			: `Den Mieter „${token}“ gibt es mehrmals; hinterlege bei diesen Mietern verschiedene E-Mail-Adressen und gib statt des Namens die E-Mail-Adresse an.`
	};
}

function planProperties(rows: DataRow[], context: ImportContext): ImportPlan {
	const results: RowResult[] = [];
	const newProperties = new Map<string, PropertyInput>();
	const newUnits: NewUnit[] = [];
	const seen = new Set<string>();
	for (const { row, values } of rows) {
		const result: RowResult = { row, values };
		results.push(result);
		if (isBlank(values)) {
			result.reason = 'Die Zeile ist leer.';
			continue;
		}
		if (!values.propertyName) {
			result.reason = 'Objekt: Bitte gib die Bezeichnung des Objekts an.';
			continue;
		}
		const unit = parseUnit(
			formDataOf({
				name: values.unitName,
				kind: word(unitKindWords, values.unitKind, 'apartment'),
				floorArea: values.floorArea
			})
		);
		if (!unit.ok) {
			result.reason = firstError(unit.errors, unitLabels);
			continue;
		}
		const existing = matchProperty(context, values);
		if (existing && 'reason' in existing) {
			result.reason = existing.reason;
			continue;
		}
		let property: NewUnit['property'];
		if (existing) {
			if (findUnit(context, existing.id, unit.data.name)) {
				result.reason = `Die Einheit „${unit.data.name}“ gibt es in „${existing.name}“ schon.`;
				continue;
			}
			property = { id: existing.id };
		} else {
			const key = `${norm(values.propertyName)}|${normStreet(values.street)}`;
			if (!newProperties.has(key)) {
				const parsed = parseProperty(
					formDataOf({
						name: values.propertyName,
						street: values.street,
						postalCode: values.postalCode,
						city: values.city
					})
				);
				if (!parsed.ok) {
					result.reason = firstError(parsed.errors, propertyLabels);
					continue;
				}
				newProperties.set(key, parsed.data);
			}
			property = { key };
		}
		const unitKey = `${'id' in property ? property.id : property.key}|${norm(unit.data.name)}`;
		if (seen.has(unitKey)) {
			result.reason = `Die Einheit „${unit.data.name}“ in „${values.propertyName}“ steht doppelt in der Datei.`;
			continue;
		}
		seen.add(unitKey);
		newUnits.push({ property, input: unit.data });
	}
	return {
		kind: 'properties',
		rows: results,
		properties: [...newProperties].map(([key, input]) => ({ key, input })),
		units: newUnits
	};
}

function planTenants(rows: DataRow[], context: ImportContext): ImportPlan {
	const results: RowResult[] = [];
	const newTenants: TenantInput[] = [];
	for (const { row, values } of rows) {
		const result: RowResult = { row, values };
		results.push(result);
		if (isBlank(values)) {
			result.reason = 'Die Zeile ist leer.';
			continue;
		}
		const parsed = parseTenant(formDataOf(values));
		if (!parsed.ok) {
			result.reason = firstError(parsed.errors, tenantLabels);
			continue;
		}
		const tenant = parsed.data;
		const name = `${tenant.firstName} ${tenant.lastName}`;
		const existing = context.tenants.find((other) => sameTenant(other, tenant));
		if (existing) {
			const by =
				existing.email && tenant.email
					? ` mit der E-Mail-Adresse „${tenant.email}“`
					: tenant.street || tenant.postalCode || tenant.city
						? ' mit dieser Adresse'
						: '';
			result.reason = `Den Mieter „${name}“${by} gibt es schon.`;
			continue;
		}
		if (newTenants.some((other) => sameTenant(other, tenant))) {
			result.reason = `Der Mieter „${name}“ steht doppelt in der Datei.`;
			continue;
		}
		newTenants.push(tenant);
	}
	return { kind: 'tenants', rows: results, tenants: newTenants };
}

/**
 * Without "Mietkonto ab", a running lease that began in the past keeps its ledger from the
 * current month, as the lease form proposes, so an import does not show years of arrears. A
 * lease that has ended keeps its whole term.
 */
function defaultLedgerStart(startDate: string, endDate: string): string {
	const currentMonth = firstOfMonth(monthOf(today()));
	if (startDate >= currentMonth) return '';
	if (endDate && endDate < currentMonth) return '';
	return currentMonth;
}

function planLeases(rows: DataRow[], context: ImportContext): ImportPlan {
	const results: RowResult[] = [];
	const newLeases: NewLease[] = [];
	const seen = new Set<string>();
	for (const { row, values } of rows) {
		const result: RowResult = { row, values };
		results.push(result);
		if (isBlank(values)) {
			result.reason = 'Die Zeile ist leer.';
			continue;
		}
		const located = locateUnit(context, values.propertyName, values.unitName);
		if (typeof located === 'string') {
			result.reason = located;
			continue;
		}
		const { property, unit } = located;

		const tenantIds: string[] = [];
		let tenantError: string | undefined;
		for (const token of values.tenantNames.split(';')) {
			if (!token.trim()) continue;
			const found = findTenant(context, token.trim());
			if (typeof found === 'string') tenantIds.push(found);
			else {
				tenantError = found.reason;
				break;
			}
		}
		if (tenantError) {
			result.reason = tenantError;
			continue;
		}

		const startDate = isoDate(values.startDate);
		const endDate = isoDate(values.endDate);
		const parsed = parseLease(
			formDataOf({
				unitId: unit.id,
				tenantIds,
				startDate,
				endDate,
				kind: word(leaseKindWords, values.kind, leaseKindOfUnit[unit.kind]),
				rentModel: 'fixed',
				operatingCostModel: word(operatingCostModelWords, values.operatingCostModel, 'prepayment'),
				heatingCostModel: word(heatingCostModelWords, values.heatingCostModel, 'prepayment'),
				baseRent: values.baseRent,
				operatingCostPrepayment: values.operatingCostPrepayment,
				heatingCostPrepayment: values.heatingCostPrepayment,
				securityDeposit: values.securityDeposit,
				persons: values.persons,
				ledgerStart: values.ledgerStart
					? isoDate(values.ledgerStart)
					: defaultLedgerStart(startDate, endDate),
				notes: values.notes
			})
		);
		if (!parsed.ok) {
			result.reason = firstError(parsed.errors, leaseLabels);
			continue;
		}
		const balance = parseOpeningBalance(formDataOf({ openingBalance: values.openingBalance }));
		if (!balance.ok) {
			result.reason = firstError(balance.errors, leaseLabels);
			continue;
		}
		const openingBalance = balance.data.openingBalance ?? 0;

		const label = `„${unit.name}“ in „${property.name}“ ab ${formatDate(parsed.data.startDate)}`;
		if (
			context.leases.some(
				(lease) => lease.unitId === unit.id && lease.startDate === parsed.data.startDate
			)
		) {
			result.reason = `Den Mietvertrag für ${label} gibt es schon.`;
			continue;
		}
		const key = `${unit.id}|${parsed.data.startDate}`;
		if (seen.has(key)) {
			result.reason = `Der Mietvertrag für ${label} steht doppelt in der Datei.`;
			continue;
		}
		seen.add(key);
		// Two leases of one unit at once would split its operating costs between them.
		const holds = (lease: { unitId: string; extraUnitIds: string[] }) =>
			lease.unitId === unit.id || lease.extraUnitIds.includes(unit.id);
		const overlap = [
			...context.leases.filter(holds),
			...newLeases.map((lease) => lease.input).filter(holds)
		].find((lease) => termsOverlap(lease, parsed.data));
		if (overlap) {
			result.reason = `Für ${label} gibt es in diesem Zeitraum schon einen Mietvertrag (ab ${formatDate(overlap.startDate)}); eine Einheit kann nur einen Vertrag zur selben Zeit haben.`;
			continue;
		}
		newLeases.push({ row, values, input: parsed.data, openingBalance });
	}
	return { kind: 'leases', rows: results, leases: newLeases };
}

/**
 * The lease a payment belongs to: the leases of the unit (as main or extra unit) running on the
 * date, else all leases of the unit; narrowed by the tenant's last name when given. Two leases
 * left is an error that asks for the last name.
 */
function findLeaseForPayment(
	context: ImportContext,
	located: Located,
	date: IsoDate,
	tenantLastName: string
): string | { reason: string } {
	const { property, unit } = located;
	const where = `„${unit.name}“ in „${property.name}“`;
	const candidates = context.leases.filter(
		(lease) => lease.unitId === unit.id || lease.extraUnitIds.includes(unit.id)
	);
	if (candidates.length === 0) return { reason: `Für ${where} gibt es keinen Mietvertrag.` };
	const running = candidates.filter(
		(lease) => lease.startDate <= date && (lease.endDate === null || lease.endDate >= date)
	);
	let pool = running.length > 0 ? running : candidates;
	const lastName = norm(tenantLastName.split(',')[0]);
	if (lastName) {
		const tenantById = new Map(context.tenants.map((tenant) => [tenant.id, tenant]));
		pool = pool.filter((lease) =>
			lease.tenantIds.some((id) => norm(tenantById.get(id)?.lastName ?? '') === lastName)
		);
		if (pool.length === 0) {
			return {
				reason: `Für ${where} gibt es keinen Mietvertrag mit einem Mieter „${tenantLastName}“.`
			};
		}
	}
	if (pool.length > 1) {
		return {
			reason: `Zu ${where} passen am ${formatDate(date)} mehrere Mietverträge; gib den Nachnamen des Mieters an.`
		};
	}
	return pool[0].id;
}

/** Payments compare by lease, date, amount and note. */
function paymentKey(leaseId: string, date: string, amount: number, note: string | null): string {
	return `${leaseId}|${date}|${amount}|${note ?? ''}`;
}

function planPayments(rows: DataRow[], context: ImportContext): ImportPlan {
	const results: RowResult[] = [];
	const newPayments: PaymentInput[] = [];
	const existing = new Set(
		context.payments.map((payment) =>
			paymentKey(payment.leaseId, payment.date, payment.amount, payment.note)
		)
	);
	for (const { row, values } of rows) {
		const result: RowResult = { row, values };
		results.push(result);
		if (isBlank(values)) {
			result.reason = 'Die Zeile ist leer.';
			continue;
		}
		const located = locateUnit(context, values.propertyName, values.unitName);
		if (typeof located === 'string') {
			result.reason = located;
			continue;
		}
		if (!values.date) {
			result.reason = 'Datum: Bitte gib ein Datum an.';
			continue;
		}
		const date = parseGermanDate(values.date);
		if (!date) {
			result.reason = 'Datum: Bitte gib ein gültiges Datum an, z. B. 03.01.2025.';
			continue;
		}
		const parsed = parsePayment(formDataOf({ date, amount: values.amount, note: values.note }));
		if (!parsed.ok) {
			result.reason = firstError(parsed.errors, paymentLabels);
			continue;
		}
		const { amount, note } = parsed.data;
		const lease = findLeaseForPayment(context, located, date, values.tenantLastName);
		if (typeof lease !== 'string') {
			result.reason = lease.reason;
			continue;
		}
		if (existing.has(paymentKey(lease, date, amount, note))) {
			result.reason = `Die Zahlung über ${formatCents(amount)} vom ${formatDate(date)} für „${located.unit.name}“ gibt es schon.`;
			continue;
		}
		newPayments.push({ leaseId: lease, date, amount, source: 'manual', note });
	}
	return { kind: 'payments', rows: results, payments: newPayments };
}

/**
 * Validates every row after the header against the mapping and the account's data and says what
 * the commit will create. Pure: the preview and the commit call it with the same input and get
 * the same plan.
 */
export function planImport(
	kind: ImportKind,
	rows: readonly string[][],
	headerIndex: number,
	mapping: ColumnMapping,
	context: ImportContext
): ImportPlan {
	const data = dataRows(rows, headerIndex, mapping, importFields[kind]);
	switch (kind) {
		case 'properties':
			return planProperties(data, context);
		case 'tenants':
			return planTenants(data, context);
		case 'leases':
			return planLeases(data, context);
		case 'payments':
			return planPayments(data, context);
	}
}

/** How many rows of the plan the commit creates. */
export function plannedCount(plan: ImportPlan): number {
	switch (plan.kind) {
		case 'properties':
			return plan.units.length;
		case 'tenants':
			return plan.tenants.length;
		case 'leases':
			return plan.leases.length;
		case 'payments':
			return plan.payments.length;
	}
}

// Commit

export type ImportSummary = {
	kind: ImportKind;
	/** Records created: units, tenants, leases or payments. */
	count: number;
	/** "1 Objekt und 2 Einheiten angelegt" */
	created: string;
	/** The rows not imported, with their reasons, in file order. */
	skipped: RowResult[];
};

function countOf(count: number, singular: string, plural: string): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function auditSummary(created: string, skipped: number): string {
	const suffix = skipped > 0 ? `, ${countOf(skipped, 'Zeile', 'Zeilen')} übersprungen` : '';
	return `CSV-Import: ${created}${suffix}`;
}

/**
 * Creates everything the plan holds, inside the account of the context. Rows of one table go
 * into one batch in chunks; leases go into one batch with their tenants, initial rent, persons,
 * opening balances and the audit entry, then the rent charges are generated. Writes nothing, not
 * even an audit line, when the plan is empty. Refuses with 409 when the rows would take the
 * account over its limits.
 */
export async function commitImport(
	db: Database,
	context: AuditContext,
	plan: ImportPlan
): Promise<ImportSummary> {
	const { accountId } = context;
	const importId = crypto.randomUUID();
	const skipped = plan.rows.filter((row) => row.reason !== undefined);

	switch (plan.kind) {
		case 'properties': {
			const created = `${countOf(plan.properties.length, 'Objekt', 'Objekte')} und ${countOf(plan.units.length, 'Einheit', 'Einheiten')} angelegt`;
			if (plan.units.length === 0) return { kind: plan.kind, count: 0, created, skipped };
			await assertQuota(db, accountId, 'properties', plan.properties.length);
			await assertQuota(db, accountId, 'units', plan.units.length);
			const propertyIds = new Map(
				plan.properties.map((property) => [property.key, crypto.randomUUID()])
			);
			const propertyRows = plan.properties.map((property) => ({
				id: propertyIds.get(property.key)!,
				accountId,
				...property.input
			}));
			const unitRows = plan.units.map((unit) => ({
				id: crypto.randomUUID(),
				accountId,
				propertyId: 'id' in unit.property ? unit.property.id : propertyIds.get(unit.property.key)!,
				...unit.input
			}));
			await runBatch(db, [
				...chunk(propertyRows, rowsPerStatement(properties)).map((rows) =>
					db.insert(properties).values(rows)
				),
				...chunk(unitRows, rowsPerStatement(units)).map((rows) => db.insert(units).values(rows)),
				auditEntry(db, context, 'import', importId, 'import', auditSummary(created, skipped.length))
			]);
			return { kind: plan.kind, count: plan.units.length, created, skipped };
		}
		case 'tenants': {
			const created = `${countOf(plan.tenants.length, 'Mieter', 'Mieter')} angelegt`;
			if (plan.tenants.length === 0) return { kind: plan.kind, count: 0, created, skipped };
			await assertQuota(db, accountId, 'tenants', plan.tenants.length);
			const rows = plan.tenants.map((tenant) => ({
				id: crypto.randomUUID(),
				accountId,
				...tenant
			}));
			await runBatch(db, [
				...chunk(rows, rowsPerStatement(tenants)).map((group) => db.insert(tenants).values(group)),
				auditEntry(db, context, 'import', importId, 'import', auditSummary(created, skipped.length))
			]);
			return { kind: plan.kind, count: rows.length, created, skipped };
		}
		case 'leases': {
			const text = `${countOf(plan.leases.length, 'Mietvertrag', 'Mietverträge')} angelegt`;
			if (plan.leases.length === 0) return { kind: plan.kind, count: 0, created: text, skipped };
			await assertQuota(db, accountId, 'leases', plan.leases.length);
			// The units and tenants of the plan come from the context loaded in this request, so
			// they belong to the account; a row deleted since then fails the whole batch.
			const created = plan.leases.map((lease) => ({ id: crypto.randomUUID(), lease }));
			const openings = created
				.filter(({ lease }) => lease.openingBalance !== 0)
				.map(({ id, lease }) => {
					const date = lease.input.ledgerStart ?? lease.input.startDate;
					return {
						id: crypto.randomUUID(),
						accountId,
						leaseId: id,
						kind: 'adjustment' as const,
						period: monthOf(date),
						dueDate: date,
						amount: lease.openingBalance,
						note: 'Anfangssaldo'
					};
				});
			const entries = created.map(({ id, lease }) => ({ id, input: lease.input }));
			const charges = await chargeSyncStatements(
				db,
				accountId,
				await newChargeLeases(db, accountId, entries),
				{ otherCharges: openings.length }
			);
			// One batch: every lease with its opening balance, rent charges and the audit line, or
			// nothing.
			await runBatch(db, [
				...newLeaseStatements(db, context, entries),
				...chunk(openings, rowsPerStatement(rentCharges)).map((rows) =>
					db.insert(rentCharges).values(rows)
				),
				...charges.statements,
				auditEntry(db, context, 'import', importId, 'import', auditSummary(text, skipped.length))
			]);
			return { kind: plan.kind, count: created.length, created: text, skipped };
		}
		case 'payments': {
			const created = `${countOf(plan.payments.length, 'Zahlung', 'Zahlungen')} angelegt`;
			if (plan.payments.length === 0) return { kind: plan.kind, count: 0, created, skipped };
			await assertQuota(db, accountId, 'payments', plan.payments.length);
			const rows = plan.payments.map((payment) => ({
				id: crypto.randomUUID(),
				accountId,
				leaseId: payment.leaseId,
				date: payment.date,
				amount: payment.amount,
				source: payment.source,
				bankTransactionId: null,
				note: payment.note ?? null
			}));
			await runBatch(db, [
				...chunk(rows, rowsPerStatement(payments)).map((group) =>
					db.insert(payments).values(group)
				),
				auditEntry(db, context, 'import', importId, 'import', auditSummary(created, skipped.length))
			]);
			return { kind: plan.kind, count: plan.payments.length, created, skipped };
		}
	}
}

// The file travels between the preview and the commit as a hidden base64 field, so the page
// needs no server-side state. Only web APIs, so it works on Node and on Workers.

/** UTF-8 text → base64. */
export function encodeContent(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

/** base64 → UTF-8 text, or undefined when the field was tampered with. */
export function decodeContent(encoded: string): string | undefined {
	try {
		const binary = atob(encoded);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return undefined;
	}
}
