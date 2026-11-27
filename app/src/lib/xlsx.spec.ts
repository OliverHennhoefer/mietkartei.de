import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { isXlsx, readXlsx, rowsToCsv, XlsxError } from './xlsx';

const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const rel = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A workbook as Excel writes it: shared strings, styles, the sheet behind a relationship. */
function workbook(sheetData: string, options: { date1904?: boolean; sheets?: string } = {}) {
	return zipSync({
		'[Content_Types].xml': strToU8('<Types/>'),
		'xl/workbook.xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${ns} ${rel}>` +
				(options.date1904 ? '<workbookPr date1904="1"/>' : '<workbookPr/>') +
				(options.sheets ??
					'<sheets><sheet name="Mieter" sheetId="1" r:id="rId3"/><sheet name="Zwei" sheetId="2" r:id="rId4"/></sheets>') +
				'</workbook>'
		),
		'xl/_rels/workbook.xml.rels': strToU8(
			'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
				'<Relationship Id="rId4" Type="worksheet" Target="worksheets/sheet1.xml"/>' +
				'<Relationship Id="rId3" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/>' +
				'</Relationships>'
		),
		'xl/sharedStrings.xml': strToU8(
			`<sst ${ns}><si><t>Nachname</t></si><si><t>Einzug</t></si><si><t>Kaltmiete</t></si>` +
				'<si><r><t>Mül</t></r><r><rPr><b/></rPr><t>ler &amp; Söhne</t></r></si><si><t xml:space="preserve"> PLZ </t></si></sst>'
		),
		'xl/styles.xml': strToU8(
			`<styleSheet ${ns}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/>` +
				'<numFmt numFmtId="165" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts>' +
				'<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>'
		),
		'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${ns}><sheetData/></worksheet>`),
		'xl/worksheets/sheet2.xml': strToU8(
			`<worksheet ${ns}><sheetData>${sheetData}</sheetData></worksheet>`
		)
	});
}

describe('readXlsx', () => {
	it('reads the first sheet with shared and inline strings, dates and German numbers', () => {
		const file = workbook(
			'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="E1" t="s"><v>4</v></c></row>' +
				'<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" s="1"><v>45658</v></c><c r="C3" s="3"><v>650.5</v></c><c r="D3" t="inlineStr"><is><t>frei</t></is></c><c r="E3"><v>10115</v></c></row>' +
				'<row r="4"><c r="A4" t="str"><f>A3</f><v>Formel</v></c><c r="B4" s="2"><v>36526.75</v></c><c r="C4"><v>0.30000000000000004</v></c><c r="D4" t="b"><v>1</v></c></row>' +
				'<row r="5"><c r="A5"/></row>'
		);
		expect(isXlsx(file)).toBe(true);
		expect(readXlsx(file)).toEqual([
			['Nachname', 'Einzug', 'Kaltmiete', '', 'PLZ'],
			[],
			['Müller & Söhne', '01.01.2025', '650,5', 'frei', '10115'],
			['Formel', '01.01.2000', '0,3', 'WAHR']
		]);
	});

	it('counts dates from 1904 when the workbook says so', () => {
		const file = workbook('<row r="1"><c r="A1" s="1"><v>0</v></c></row>', { date1904: true });
		expect(readXlsx(file)).toEqual([['01.01.1904']]);
	});

	it('reads cells without references, phonetic hints, false and missing values', () => {
		const file = zipSync({
			'xl/workbook.xml': strToU8(`<workbook ${ns}><sheets><sheet name="a"/></sheets></workbook>`),
			'xl/sharedStrings.xml': strToU8(
				`<sst ${ns}><si><t>Tokio</t><rPh><t>とうきょう</t></rPh></si></sst>`
			),
			'xl/worksheets/sheet1.xml': strToU8(
				`<worksheet ${ns}><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>7</v></c>` +
					'<c t="inlineStr"/><c t="b"><v>0</v></c><c t="e"><v>#DIV/0!</v></c><c><v>x</v></c></row></sheetData></worksheet>'
			)
		});
		expect(readXlsx(file)).toEqual([['Tokio', '', '', 'FALSCH', '#DIV/0!', 'x']]);
	});

	it('refuses a workbook without its sheet or with broken XML', () => {
		const sheetless = zipSync({
			'xl/workbook.xml': strToU8(`<workbook ${ns}><sheets><sheet name="a"/></sheets></workbook>`)
		});
		expect(() => readXlsx(sheetless)).toThrow('Kein Tabellenblatt');
		const broken = zipSync({ 'xl/workbook.xml': strToU8('<workbook><sheets>') });
		expect(() => readXlsx(broken)).toThrow(XlsxError);
	});

	it('refuses what is not a workbook', () => {
		expect(isXlsx(strToU8('Name;Ort\n'))).toBe(false);
		expect(() => readXlsx(strToU8('Name;Ort\n'))).toThrow(XlsxError);
		expect(() => readXlsx(zipSync({ 'a.txt': strToU8('x') }))).toThrow(XlsxError);
		expect(() =>
			readXlsx(workbook('', { sheets: '<sheets><sheet name="a" r:id="rId9"/></sheets>' }))
		).not.toThrow();
	});

	it('refuses row and column numbers beyond what Excel writes', () => {
		for (const sheet of [
			'<row r="1048577"><c r="A1048577"><v>1</v></c></row>',
			'<row r="200000"><c r="A200000"><v>1</v></c></row>',
			'<row r="1e9"/>',
			'<row r="2"/><row r="1"/>',
			'<row r="1"><c r="XFE1"><v>1</v></c></row>'
		]) {
			expect(() => readXlsx(workbook(sheet)), sheet).toThrow(XlsxError);
		}
		expect(readXlsx(workbook('<row r="1"><c r="XFD1"><v>1</v></c></row>'))[0]).toHaveLength(16_384);
	});
});

describe('rowsToCsv', () => {
	it('writes semicolon CSV and quotes what needs it', () => {
		expect(
			rowsToCsv([
				['a', 'b;c'],
				['"x"', '']
			])
		).toBe('a;"b;c"\n"""x""";\n');
	});
});

describe('readXlsx with files of real spreadsheet programs', () => {
	const expected = [
		['Objekt', 'Einheit', 'Mieter', 'Mietbeginn', 'Kaltmiete', 'Nebenkosten'],
		['Lindenweg 4', 'EG links', 'Schulz, Anna', '01.04.2021', '650,5', '180'],
		['Lindenweg 4', 'OG', 'Öztürk, Kemal', '15.10.2019', '720', '210,25']
	];
	for (const file of ['openpyxl.xlsx', 'libreoffice.xlsx']) {
		it(`reads ${file}`, () => {
			const bytes = new Uint8Array(readFileSync(`src/lib/xlsx-fixtures/${file}`));
			expect(readXlsx(bytes)).toEqual(expected);
		});
	}
});
