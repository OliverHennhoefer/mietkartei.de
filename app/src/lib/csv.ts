// CSV helpers shared by the bank import and the data import. German bank exports are usually
// semicolon-separated, often windows-1252 encoded and sometimes start with preamble lines before
// the header; this module reads such files into rows and records.
// Only web-standard APIs, so the code runs on Node and on Cloudflare Workers alike.

export type Delimiter = ';' | ',' | '\t';

/** In order of preference: the semicolon is the German default and keeps a tie. */
const DELIMITERS: readonly Delimiter[] = [';', ',', '\t'];

function isDelimiter(char: string): char is Delimiter {
	return (DELIMITERS as readonly string[]).includes(char);
}

// The code points of the bytes 0x80–0x9F in windows-1252 (WHATWG Encoding Standard); every other
// byte is the code point of the same number. Node's TextDecoder('windows-1252') leaves this range
// as C1 control characters, so € (0x80), „“ (0x84, 0x93) and – (0x96) in a bank export need it.
const WINDOWS_1252_C1 = [
	0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
	0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
	0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178
];

function decodeWindows1252(bytes: Uint8Array): string {
	return new TextDecoder('windows-1252')
		.decode(bytes)
		.replace(/[\u0080-\u009f]/g, (char) =>
			String.fromCharCode(WINDOWS_1252_C1[char.charCodeAt(0) - 0x80])
		);
}

/**
 * Bytes of an uploaded file → text with LF line breaks. A UTF-8 byte order mark is stripped;
 * bytes that are not valid UTF-8 are read as windows-1252, the encoding of many German bank
 * exports (`Müller` with 0xFC).
 */
export function decodeCsv(bytes: Uint8Array): string {
	const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
	const body = hasBom ? bytes.subarray(3) : bytes;
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(body);
	} catch {
		text = decodeWindows1252(body);
	}
	return text.replace(/\r\n?/g, '\n');
}

/**
 * The delimiter of the first non-empty line: the candidate that occurs most often outside quotes.
 * The semicolon wins a tie (and a line without any delimiter), as it is what German spreadsheets
 * and banks export.
 */
export function detectDelimiter(text: string): Delimiter {
	// The first line with a non-blank character; `.` does not match the line break.
	const line = /^.*\S.*$/m.exec(text)?.[0] ?? '';
	const counts: Record<Delimiter, number> = { ';': 0, ',': 0, '\t': 0 };
	let quoted = false;
	for (const char of line) {
		if (char === '"') quoted = !quoted;
		else if (!quoted && isDelimiter(char)) counts[char] += 1;
	}
	return DELIMITERS.reduce((best, candidate) =>
		counts[candidate] > counts[best] ? candidate : best
	);
}

/**
 * Text → rows of fields, as in RFC 4180: a field may be quoted with double quotes, then it may
 * contain the delimiter and line breaks, and a doubled quote inside it is a literal quote.
 * Unquoted fields are trimmed, blank lines are skipped, and rows keep their own length (no
 * padding). Line breaks may be LF, CRLF or CR; inside a quoted field they come out as LF.
 */
export function parseCsv(
	text: string,
	options: { delimiter?: Delimiter | 'auto' } = {}
): string[][] {
	const delimiter =
		!options.delimiter || options.delimiter === 'auto' ? detectDelimiter(text) : options.delimiter;
	const source = text.replace(/\r\n?/g, '\n');
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false; // between the opening and the closing quote of a field
	let wasQuoted = false; // the field had quotes, so it is kept as it is
	let lineStart = 0;

	const endField = () => {
		row.push(wasQuoted ? field : field.trim());
		field = '';
		wasQuoted = false;
	};
	const endLine = (end: number) => {
		endField();
		if (source.slice(lineStart, end).trim() !== '') rows.push(row);
		row = [];
		lineStart = end + 1;
	};

	for (let i = 0; i < source.length; i += 1) {
		const char = source[i];
		if (quoted) {
			if (char !== '"') field += char;
			else if (source[i + 1] === '"') {
				field += '"';
				i += 1;
			} else quoted = false;
		} else if (char === delimiter) endField();
		else if (char === '\n') endLine(i);
		else if (char === '"' && !wasQuoted && field.trim() === '') {
			// An opening quote, possibly after some whitespace.
			quoted = true;
			wasQuoted = true;
			field = '';
		} else if (!wasQuoted || (char !== ' ' && char !== '\t')) {
			// Whitespace after the closing quote is dropped; anything else is kept, leniently.
			field += char;
		}
	}
	if (lineStart < source.length) endLine(source.length);
	return rows;
}

/** Column names compare case-insensitively, trimmed and without a byte order mark. */
function normalizeName(name: string): string {
	return name
		.replace(/^\ufeff/, '')
		.trim()
		.toLowerCase();
}

/**
 * The index of the first row that contains every required column name, or -1. Names compare
 * case-insensitively and trimmed. Bank exports (ING, for example) have preamble lines before the
 * header, so the header is not always row 0.
 */
export function findHeaderRow(rows: string[][], required: string[]): number {
	const wanted = required.map(normalizeName);
	return rows.findIndex((row) => {
		const names = new Set(row.map(normalizeName));
		return wanted.every((name) => names.has(name));
	});
}

/**
 * The rows after the header as objects keyed by the header names (trimmed). A missing cell is '',
 * a cell beyond the header is dropped, a column without a name is dropped, the first of two
 * columns with the same name wins, and rows without any content are skipped.
 */
export function toRecords(rows: string[][], headerIndex: number): Record<string, string>[] {
	if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= rows.length) {
		throw new RangeError(`No header row at index ${headerIndex}`);
	}
	const columns = new Map<string, number>();
	rows[headerIndex].forEach((cell, index) => {
		const name = cell.replace(/^\ufeff/, '').trim();
		if (name !== '' && !columns.has(name)) columns.set(name, index);
	});

	const records: Record<string, string>[] = [];
	for (const row of rows.slice(headerIndex + 1)) {
		if (row.every((cell) => cell === '')) continue;
		const record: Record<string, string> = {};
		for (const [name, index] of columns) record[name] = row[index] ?? '';
		records.push(record);
	}
	return records;
}
