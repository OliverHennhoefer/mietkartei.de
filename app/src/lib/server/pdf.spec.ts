import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream, type PDFPage } from 'pdf-lib';
import { pdfResponse, renderLetter, toWinAnsi, type Letter, type PdfTable } from './pdf';

const letter: Letter = {
	sender: ['Erika Vermieter', 'Musterstraße 1', '10115 Berlin'],
	recipient: ['Herrn', 'Max Müller', 'Beispielweg 2', '10117 Berlin'],
	date: 'Berlin, 15.03.2026',
	subject: 'Betriebskostenabrechnung 2025',
	paragraphs: [
		'Sehr geehrter Herr Müller,',
		'anbei erhältst du die Abrechnung für das Jahr 2025.\nDer Betrag ist bis zum 15.04.2026 fällig.'
	],
	closing: ['Mit freundlichen Grüßen', '', 'Erika Vermieter']
};

const costTable: PdfTable = {
	title: 'Kostenaufstellung',
	columns: [
		{ label: 'Kostenart' },
		{ label: 'Schlüssel', width: 0.2 },
		{ label: 'Gesamt', align: 'right', width: 0.15 },
		{ label: 'Dein Anteil', align: 'right', width: 0.15 }
	],
	rows: [
		['Grundsteuer', 'Wohnfläche', '1.200,00 €', '393,00 €'],
		['Wasser und Abwasser', 'Personen', '2.400,50 €', '800,17 €']
	],
	footer: ['Summe', '', '3.600,50 €', '1.193,17 €']
};

// The WinAnsi block 0x80–0x9F (`?` where the encoding has no character); all other bytes are Latin-1.
const WIN_ANSI_HIGH = '€?‚ƒ„…†‡ˆ‰Š‹Œ?Ž??‘’“”•–—˜™š›œ?žŸ';

function decodeWinAnsi(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) =>
		byte >= 0x80 && byte <= 0x9f ? WIN_ANSI_HIGH[byte - 0x80] : String.fromCharCode(byte)
	).join('');
}

/** The text of a page as pdf-lib wrote it: the strings shown by its content streams, one per line. */
function pageText(page: PDFPage): string {
	const contents = page.node.Contents();
	const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
	let text = '';
	for (const ref of refs) {
		const stream = page.doc.context.lookup(ref);
		if (!(stream instanceof PDFRawStream)) continue;
		const operators = decodeWinAnsi(decodePDFRawStream(stream).decode());
		for (const [, hex] of operators.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
			const bytes = Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
			text += decodeWinAnsi(bytes) + '\n';
		}
	}
	return text;
}

async function renderAndLoad(input: Letter) {
	const bytes = await renderLetter(input);
	const doc = await PDFDocument.load(bytes);
	return { bytes, doc, pages: doc.getPages().map(pageText) };
}

describe('renderLetter', () => {
	it('renders a one-page letter with the DIN blocks and a footer', async () => {
		const { bytes, doc, pages } = await renderAndLoad({ ...letter, tables: [costTable] });
		expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
		expect(doc.getPageCount()).toBe(1);
		expect(doc.getTitle()).toBe('Betriebskostenabrechnung 2025');
		expect(pages[0]).toContain('Max Müller');
		expect(pages[0]).toContain('Berlin, 15.03.2026');
		expect(pages[0]).toContain('Betriebskostenabrechnung 2025');
		expect(pages[0]).toContain('Der Betrag ist bis zum 15.04.2026 fällig.');
		expect(pages[0]).toContain('Kostenaufstellung');
		expect(pages[0]).toContain('1.193,17 €');
		expect(pages[0]).toContain('Mit freundlichen Grüßen');
		expect(pages[0]).toContain('Seite 1 von 1');
	});

	it('breaks a long table over pages and repeats the header', async () => {
		const rows = Array.from({ length: 90 }, (_, index) => [
			`Position ${index + 1}`,
			'Wohnfläche',
			'10,00 €',
			'1,00 €'
		]);
		const { doc, pages } = await renderAndLoad({ ...letter, tables: [{ ...costTable, rows }] });
		expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
		pages.forEach((page, index) => {
			expect(page).toContain(`Seite ${index + 1} von ${pages.length}`);
		});
		// Every page with rows starts them under a header; the closing may sit alone on the last page.
		const withRows = pages.filter((page) => page.includes('Position '));
		expect(withRows.length).toBeGreaterThanOrEqual(2);
		for (const page of withRows) {
			expect(page).toContain('Kostenart');
			expect(page.indexOf('Kostenart')).toBeLessThan(page.indexOf('Position '));
		}
		// Every row is on exactly one page, in order, and the sum row closes the table.
		const all = pages.join('');
		expect(all.match(/Position \d+\n/g)).toHaveLength(90);
		expect(all.indexOf('Position 90')).toBeLessThan(all.indexOf('Summe'));
		expect(all).toContain('Mit freundlichen Grüßen');
	});

	it('keeps blocks in the given order', async () => {
		const { pages } = await renderAndLoad({
			...letter,
			paragraphs: ['Dieser Absatz wird ignoriert.'],
			blocks: [
				{ paragraph: 'Erster Absatz.' },
				{ table: { ...costTable, title: 'Tabelle A' } },
				{ paragraph: 'Text zwischen den Tabellen.' },
				{ table: { ...costTable, title: 'Tabelle B' } }
			]
		});
		const text = pages.join('');
		expect(text).not.toContain('ignoriert');
		expect(text.indexOf('Erster Absatz.')).toBeLessThan(text.indexOf('Tabelle A'));
		expect(text.indexOf('Tabelle A')).toBeLessThan(text.indexOf('Text zwischen den Tabellen.'));
		expect(text.indexOf('Text zwischen den Tabellen.')).toBeLessThan(text.indexOf('Tabelle B'));
	});

	it('wraps long paragraphs and words without throwing', async () => {
		const sentence = 'Die Abrechnung folgt den Vorschriften der Betriebskostenverordnung. ';
		const { doc, pages } = await renderAndLoad({
			...letter,
			paragraphs: [sentence.repeat(40), 'x'.repeat(400)]
		});
		expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
		expect(pages.join('').match(/x+/g)?.length).toBeGreaterThan(1);
	});

	it('renders text WinAnsi cannot encode by its ASCII form', async () => {
		const { pages } = await renderAndLoad({
			...letter,
			subject: 'CO₂-Kostenaufteilung 2025 – Fläche 72 m² · 5 kg/m³',
			paragraphs: ['Anteil … – — ‒ ₂ ₃ 😀 ŒœŠšŸŽžƒˆ˜–‘’‚“”„†‡•‰‹›€™'],
			tables: [{ columns: [{ label: 'CO₂' }], rows: [['₃']] }]
		});
		expect(pages[0]).toContain('CO2-Kostenaufteilung 2025 – Fläche 72 m² · 5 kg/m³');
		expect(pages[0]).toContain('Anteil ... – - - 2 3 ? ŒœŠšŸŽžƒˆ˜–‘’‚“”„†‡•‰‹›€™');
		expect(pages[0]).toContain('CO2\n3\n');
	});
});

describe('toWinAnsi', () => {
	it('keeps what Helvetica can show', () => {
		const text = 'Äöü ß € 72 m² 5 m³ 2025–2026 „Zitat“ • 50 % § 556 BGB\nZeile 2';
		expect(toWinAnsi(text)).toBe(text);
	});

	it('replaces the rest by a close ASCII form', () => {
		expect(toWinAnsi('CO₂')).toBe('CO2');
		expect(toWinAnsi('H₂O₃')).toBe('H2O3');
		expect(toWinAnsi('a‒b—c−d')).toBe('a-b-c-d');
		expect(toWinAnsi('und so weiter…')).toBe('und so weiter...');
		expect(toWinAnsi('x⁴')).toBe('x4');
		expect(toWinAnsi('Tab\tund\r\nZeile')).toBe('Tab und\nZeile');
		expect(toWinAnsi('Danke 😀 Привет')).toBe('Danke ? ??????');
		expect(toWinAnsi('')).toBe('');
	});
});

describe('pdfResponse', () => {
	it('serves the bytes inline with an encoded and a plain file name', async () => {
		const bytes = new TextEncoder().encode('%PDF-1.7');
		const response = pdfResponse(bytes, 'Abrechnung 2025 Müller & Söhne.pdf');
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('application/pdf');
		expect(response.headers.get('Content-Disposition')).toBe(
			`inline; filename="Abrechnung 2025 Mueller _ Soehne.pdf"; filename*=UTF-8''Abrechnung%202025%20M%C3%BCller%20%26%20S%C3%B6hne.pdf`
		);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
	});
});
