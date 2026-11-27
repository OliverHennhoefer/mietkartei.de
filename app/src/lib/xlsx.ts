import { unzipSync } from 'fflate';
import { child, children, parseXml, XmlError, type XmlElement } from './xml';

// Reads the first worksheet of an Excel file (.xlsx, Office Open XML) into rows of text, for the
// data import: most landlord software exports Excel, and saving each sheet as CSV first is a
// step that loses landlords. Only what the import needs: cell values as Excel shows them in a
// German locale (650,5 and 01.01.2025), no formulas (their last value), no formatting. Only
// web-standard APIs and fflate, so it runs on Node and on Cloudflare Workers alike.

/** An .xlsx file starts like every ZIP archive. */
export function isXlsx(bytes: Uint8Array): boolean {
	return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** What one file of the archive may unpack to; an upload of 2 MB is far below in practice. */
const MAX_PART_BYTES = 64 * 1024 * 1024;

export class XlsxError extends Error {}

/** Built-in number formats that show a date (ECMA-376 Part 1, 18.8.30). */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** Whether a custom format code shows a date: d, m or y outside quotes and brackets. */
function isDateFormat(code: string): boolean {
	const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
	return /[dmy]/i.test(bare) && !/^[#0.,%E+\- ]*$/.test(bare);
}

/** The text of an element and everything below it, as in a rich-text shared string. */
function allText(element: XmlElement): string {
	if (element.name === 't') return element.text;
	if (element.name === 'rPh') return ''; // phonetic hints of East Asian text
	return element.children.map(allText).join('');
}

/** `AB12` → 27 (0-based column). */
function columnOf(reference: string): number | undefined {
	const letters = /^([A-Z]+)\d+$/i.exec(reference)?.[1];
	if (!letters) return undefined;
	let column = 0;
	for (const letter of letters.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
	return column - 1;
}

/** A serial date of Excel as `DD.MM.YYYY` (with the time cut off). */
function serialDate(serial: number, date1904: boolean): string {
	// Day 0 of the 1900 system is 1899-12-30 once Excel's phantom 29 February 1900 is skipped.
	const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
	const date = new Date(epoch + Math.floor(serial) * 86_400_000);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

/** A number as a German spreadsheet shows it without grouping: `650,5`, `-12`. */
function germanNumber(value: number): string {
	return String(Number(value.toPrecision(15))).replace('.', ',');
}

function part(files: Record<string, Uint8Array>, path: string): XmlElement | undefined {
	const bytes = files[path];
	return bytes ? parseXml(new TextDecoder().decode(bytes)) : undefined;
}

/** `xl/worksheets/sheet1.xml` from a target relative to `xl/` (or absolute). */
function resolve(target: string): string {
	return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
}

/**
 * The rows of the first worksheet, each as long as its last filled cell, empty rows kept as [].
 * Throws XlsxError when the file is not a readable workbook.
 */
export function readXlsx(bytes: Uint8Array): string[][] {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes, {
			filter: (file) => {
				if (file.originalSize > MAX_PART_BYTES) throw new XlsxError('Teil zu groß');
				return (
					(file.name.startsWith('xl/') && file.name.endsWith('.xml')) || file.name.endsWith('.rels')
				);
			}
		});
	} catch (error) {
		throw error instanceof XlsxError ? error : new XlsxError('Keine ZIP-Datei');
	}
	try {
		const workbook = part(files, 'xl/workbook.xml');
		if (!workbook) throw new XlsxError('Keine Arbeitsmappe');
		const date1904 = ['1', 'true'].includes(
			child(workbook, 'workbookPr')?.attributes.date1904 ?? ''
		);
		const firstSheet = children(child(workbook, 'sheets'), 'sheet')[0];
		const relation = firstSheet?.attributes['id'];
		const target = children(part(files, 'xl/_rels/workbook.xml.rels'), 'Relationship').find(
			(entry) => entry.attributes.Id === relation
		)?.attributes.Target;
		const sheet = part(files, target ? resolve(target) : 'xl/worksheets/sheet1.xml');
		if (!sheet) throw new XlsxError('Kein Tabellenblatt');

		const shared = children(part(files, 'xl/sharedStrings.xml'), 'si').map(allText);
		const styles = part(files, 'xl/styles.xml');
		const customDates = new Set(
			children(child(styles, 'numFmts'), 'numFmt')
				.filter((format) => isDateFormat(format.attributes.formatCode ?? ''))
				.map((format) => Number(format.attributes.numFmtId))
		);
		const dateStyles = children(child(styles, 'cellXfs'), 'xf').map((xf) => {
			const id = Number(xf.attributes.numFmtId ?? 0);
			return DATE_FORMAT_IDS.has(id) || customDates.has(id);
		});

		const rows: string[][] = [];
		for (const row of children(child(sheet, 'sheetData'), 'row')) {
			const index = Number(row.attributes.r ?? rows.length + 1) - 1;
			while (rows.length < index) rows.push([]);
			const cells: string[] = [];
			for (const cell of children(row, 'c')) {
				const column = columnOf(cell.attributes.r ?? '') ?? cells.length;
				const raw = child(cell, 'v')?.text ?? '';
				let value: string;
				switch (cell.attributes.t) {
					case 's':
						value = shared[Number(raw)] ?? '';
						break;
					case 'inlineStr':
						value = child(cell, 'is') ? allText(child(cell, 'is')!) : '';
						break;
					case 'b':
						value = raw === '1' ? 'WAHR' : 'FALSCH';
						break;
					case 'str':
					case 'e':
						value = raw;
						break;
					default: {
						const number = Number(raw);
						if (raw === '' || !Number.isFinite(number)) value = raw;
						else if (dateStyles[Number(cell.attributes.s ?? 0)])
							value = serialDate(number, date1904);
						else value = germanNumber(number);
					}
				}
				while (cells.length < column) cells.push('');
				cells[column] = value.trim();
			}
			rows[index] = cells;
		}
		while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell === '')) rows.pop();
		return rows;
	} catch (error) {
		if (error instanceof XlsxError) throw error;
		if (error instanceof XmlError) throw new XlsxError('Unlesbares XML');
		throw error;
	}
}

const cell = (value: string) => (/[;"\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/** Rows as semicolon CSV, which the import reads like an uploaded CSV file. */
export function rowsToCsv(rows: readonly string[][]): string {
	return rows.map((row) => row.map(cell).join(';')).join('\n') + '\n';
}
