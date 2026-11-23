// The DATEV Buchungsstapel (format EXTF, version 700, category 21): the file a Steuerberater
// imports into DATEV Rechnungswesen. One header line with Berater, Mandant, Wirtschaftsjahr and
// period, one line of column names, then one line per booking. mietkartei writes the first 14
// columns, which hold everything a bank booking needs; DATEV takes the rest as empty.

export interface DatevHeader {
	/** Beraternummer of the Steuerberater, 1001 to 9999999. */
	advisorNumber: string;
	/** Mandantennummer at the Steuerberater, 1 to 99999. */
	clientNumber: string;
	/** YYYY-MM-DD: the first day of the Wirtschaftsjahr the period lies in. */
	fiscalYearStart: string;
	/** Sachkontenlänge: the number of digits of the accounts, 4 to 8. */
	accountLength: number;
	/** YYYY-MM-DD, both within the Wirtschaftsjahr. */
	from: string;
	to: string;
	/** Bezeichnung of the Stapel, at most 30 characters. */
	label: string;
	createdAt: Date;
}

export interface DatevBooking {
	/** YYYY-MM-DD, within the period of the header. */
	date: string;
	/** Cents, as seen from the account: positive is Soll (money in on a bank account). */
	amount: number;
	/** The bank account, e.g. 1200. */
	account: string;
	/** The Gegenkonto, e.g. 8005. */
	contraAccount: string;
	/** Buchungstext, cut to 60 characters. */
	text: string;
}

export const datevColumns = [
	'Umsatz (ohne Soll/Haben-Kz)',
	'Soll/Haben-Kennzeichen',
	'WKZ Umsatz',
	'Kurs',
	'Basis-Umsatz',
	'WKZ Basis-Umsatz',
	'Konto',
	'Gegenkonto (ohne BU-Schlüssel)',
	'BU-Schlüssel',
	'Belegdatum',
	'Belegfeld 1',
	'Belegfeld 2',
	'Skonto',
	'Buchungstext'
];

/** A text field: quoted, quotes doubled, line breaks and semicolons as spaces. */
function quoted(value: string, max?: number): string {
	const clean = value
		.replace(/[\r\n;]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const cut = max === undefined ? clean : [...clean].slice(0, max).join('');
	return `"${cut.replace(/"/g, '""')}"`;
}

const compact = (day: string) => day.replaceAll('-', '');

function timestamp(at: Date): string {
	const pad = (value: number, length = 2) => String(value).padStart(length, '0');
	return (
		`${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
		`${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}` +
		pad(at.getUTCMilliseconds(), 3)
	);
}

/** 1234,56: always positive, the sign goes into the Soll/Haben-Kennzeichen. */
function amountOf(cents: number): string {
	const value = Math.abs(cents);
	return `${Math.floor(value / 100)},${String(value % 100).padStart(2, '0')}`;
}

export function datevHeaderLine(header: DatevHeader): string {
	return [
		'"EXTF"',
		'700',
		'21',
		'"Buchungsstapel"',
		'13',
		timestamp(header.createdAt),
		'',
		'""',
		'"mietkartei"',
		'""',
		header.advisorNumber,
		header.clientNumber,
		compact(header.fiscalYearStart),
		String(header.accountLength),
		compact(header.from),
		compact(header.to),
		quoted(header.label, 30),
		'""',
		'1',
		'0',
		'0',
		'"EUR"',
		'',
		'""',
		'',
		'',
		'""',
		'',
		'',
		'""',
		'""'
	].join(';');
}

export function datevBookingLine(booking: DatevBooking): string {
	const [, month, day] = booking.date.split('-');
	return [
		amountOf(booking.amount),
		booking.amount >= 0 ? '"S"' : '"H"',
		'"EUR"',
		'',
		'',
		'""',
		booking.account,
		booking.contraAccount,
		'""',
		`${day}${month}`,
		'""',
		'""',
		'',
		quoted(booking.text, 60)
	].join(';');
}

/** The whole file as text, lines ended by CRLF; encode it with {@link windows1252}. */
export function datevBuchungsstapel(header: DatevHeader, bookings: DatevBooking[]): string {
	const lines = [
		datevHeaderLine(header),
		datevColumns.join(';'),
		...bookings.map(datevBookingLine)
	];
	return lines.map((line) => `${line}\r\n`).join('');
}

// The characters of Windows-1252 at 0x80 to 0x9F; everything else up to 0xFF is Latin-1.
const upper: Record<string, number> = {
	'€': 0x80,
	'‚': 0x82,
	ƒ: 0x83,
	'„': 0x84,
	'…': 0x85,
	'†': 0x86,
	'‡': 0x87,
	ˆ: 0x88,
	'‰': 0x89,
	Š: 0x8a,
	'‹': 0x8b,
	Œ: 0x8c,
	Ž: 0x8e,
	'‘': 0x91,
	'’': 0x92,
	'“': 0x93,
	'”': 0x94,
	'•': 0x95,
	'–': 0x96,
	'—': 0x97,
	'˜': 0x98,
	'™': 0x99,
	š: 0x9a,
	'›': 0x9b,
	œ: 0x9c,
	ž: 0x9e,
	Ÿ: 0x9f
};

/** DATEV reads the file as Windows-1252 (ANSI); a character it cannot hold becomes „?“. */
export function windows1252(text: string): Uint8Array<ArrayBuffer> {
	const bytes: number[] = [];
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0x3f;
		if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
		else bytes.push(upper[char] ?? 0x3f);
	}
	return Uint8Array.from(bytes);
}

/**
 * The Sachkontenlänge for these account numbers: the longest, at least 4. DATEV expects every
 * Sachkonto with exactly this many digits, so numbers of another length are reported.
 */
export function accountLengthOf(numbers: string[]): { length: number; uneven: string[] } {
	const length = Math.max(4, ...numbers.map((number) => number.length));
	return { length, uneven: [...new Set(numbers.filter((number) => number.length !== length))] };
}
