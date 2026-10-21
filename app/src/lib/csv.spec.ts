import { describe, expect, it } from 'vitest';
import { decodeCsv, detectDelimiter, findHeaderRow, parseCsv, toRecords } from './csv';

const utf8 = (text: string) => new TextEncoder().encode(text);

// An ING export: two preamble lines, a blank line, then the header, with "Währung" twice.
const ingExport = [
	'Umsatzanzeige;Datei erstellt am: 20.10.2026 10:00',
	'IBAN;DE12 5001 0517 5407 3249 31',
	'',
	'Buchung;Valuta;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung',
	'01.10.2026;01.10.2026;Max Müller;Gutschrift;Miete Oktober;1.234,56;EUR;850,00;EUR',
	'05.10.2026;05.10.2026;Erika Schmidt;Gutschrift;Miete;2.084,56;EUR'
].join('\n');

describe('decodeCsv', () => {
	it('reads UTF-8 with a byte order mark as UTF-8 and strips the mark', () => {
		const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Name;Betrag\nMüller;12,50')]);
		expect(decodeCsv(bytes)).toBe('Name;Betrag\nMüller;12,50');
	});

	it('falls back to windows-1252 for bytes that are not UTF-8', () => {
		// "Müller;Straße;€ „Miete“ – Okt." as a German bank writes it: ü = 0xFC, ß = 0xDF and,
		// in the range a latin1 decoder gets wrong, € = 0x80, „ = 0x84, “ = 0x93, – = 0x96.
		const bytes = new Uint8Array([
			0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x3b, 0x53, 0x74, 0x72, 0x61, 0xdf, 0x65, 0x3b, 0x80,
			0x20, 0x84, 0x4d, 0x69, 0x65, 0x74, 0x65, 0x93, 0x20, 0x96, 0x20, 0x4f, 0x6b, 0x74, 0x2e
		]);
		expect(decodeCsv(bytes)).toBe('Müller;Straße;€ „Miete“ – Okt.');
	});

	it('normalizes CRLF and CR to LF', () => {
		expect(decodeCsv(utf8('a;b\r\nc;d\re;f\n'))).toBe('a;b\nc;d\ne;f\n');
	});

	it('decodes an empty file', () => {
		expect(decodeCsv(new Uint8Array())).toBe('');
	});
});

describe('detectDelimiter', () => {
	it('picks the most frequent candidate of the first non-empty line', () => {
		expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
		expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
		expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
		expect(detectDelimiter('\n\n  \na,b\n')).toBe(',');
	});

	it('ignores delimiters inside quotes', () => {
		expect(detectDelimiter('"a;b;c","d;e"\n')).toBe(',');
	});

	it('prefers the semicolon on a tie and without any delimiter', () => {
		expect(detectDelimiter('a;b,c')).toBe(';');
		expect(detectDelimiter('Kontoauszug')).toBe(';');
		expect(detectDelimiter('')).toBe(';');
	});
});

describe('parseCsv', () => {
	it('reads a semicolon file with a quoted delimiter, line break and doubled quote', () => {
		const text =
			'Name;Verwendungszweck;Betrag\n"Müller, Max";"Miete; Oktober\nEinheit ""2 OG""";850,00\n';
		expect(parseCsv(text)).toEqual([
			['Name', 'Verwendungszweck', 'Betrag'],
			['Müller, Max', 'Miete; Oktober\nEinheit "2 OG"', '850,00']
		]);
	});

	it('auto-detects a comma file', () => {
		expect(parseCsv('a,b,c\n1,"2,5",3\n')).toEqual([
			['a', 'b', 'c'],
			['1', '2,5', '3']
		]);
	});

	it('reads a tab file', () => {
		expect(parseCsv('Name\tBetrag\nMüller\t12,50\n')).toEqual([
			['Name', 'Betrag'],
			['Müller', '12,50']
		]);
	});

	it('trims unquoted fields and keeps quoted ones as they are', () => {
		expect(parseCsv(' a ; " b " ;c;\n')).toEqual([['a', ' b ', 'c', '']]);
	});

	it('skips blank lines and keeps rows of different lengths', () => {
		expect(parseCsv('\na;b;c\n\n   \n1;2\n\n')).toEqual([
			['a', 'b', 'c'],
			['1', '2']
		]);
		expect(parseCsv('')).toEqual([]);
		expect(parseCsv('a;b')).toEqual([['a', 'b']]);
	});

	it('accepts CRLF and CR line breaks, also inside quoted fields', () => {
		expect(parseCsv('a;b\r\n1;"x\r\ny"\r2;3')).toEqual([
			['a', 'b'],
			['1', 'x\ny'],
			['2', '3']
		]);
	});

	it('uses the given delimiter instead of guessing', () => {
		expect(parseCsv('a;b,c', { delimiter: ',' })).toEqual([['a;b', 'c']]);
		expect(parseCsv('a;b,c', { delimiter: 'auto' })).toEqual([['a', 'b,c']]);
	});
});

describe('findHeaderRow', () => {
	it('skips the preamble lines of a bank export', () => {
		const rows = parseCsv(ingExport);
		expect(findHeaderRow(rows, ['Buchung', 'Betrag', 'Verwendungszweck'])).toBe(2);
	});

	it('compares names case-insensitively, trimmed and without a byte order mark', () => {
		expect(findHeaderRow([['\ufeff Buchung ', 'BETRAG']], ['buchung', 'Betrag'])).toBe(0);
	});

	it('returns -1 when a required column is missing', () => {
		expect(findHeaderRow(parseCsv(ingExport), ['Buchung', 'Kontonummer'])).toBe(-1);
		expect(findHeaderRow([], ['Buchung'])).toBe(-1);
	});
});

describe('toRecords', () => {
	it('keys rows by the header and fills a short row with empty strings', () => {
		const rows = parseCsv(ingExport);
		const records = toRecords(rows, findHeaderRow(rows, ['Buchung']));
		expect(records).toHaveLength(2);
		expect(records[0]).toEqual({
			Buchung: '01.10.2026',
			Valuta: '01.10.2026',
			'Auftraggeber/Empfänger': 'Max Müller',
			Buchungstext: 'Gutschrift',
			Verwendungszweck: 'Miete Oktober',
			Saldo: '1.234,56',
			Währung: 'EUR',
			Betrag: '850,00'
		});
		expect(records[1].Saldo).toBe('2.084,56');
		expect(records[1].Betrag).toBe('');
	});

	it('skips rows without any content and drops cells beyond the header', () => {
		const rows = [
			['a', ' b ', ''],
			['', ''],
			['1', '2', '3', '4']
		];
		expect(toRecords(rows, 0)).toEqual([{ a: '1', b: '2' }]);
	});

	it('refuses an index that is no row', () => {
		expect(() => toRecords([['a']], -1)).toThrow(RangeError);
		expect(() => toRecords([['a']], 1)).toThrow(RangeError);
	});
});
