// PDF letters: the operating cost statement per lease and the index rent increase. Built with
// pdf-lib and the standard Helvetica fonts, which every viewer ships, so nothing is embedded and
// the renderer runs on Node and on Cloudflare Workers alike. The layout follows DIN 5008 form B,
// so the recipient block shows in the window of a DIN lang envelope.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export type PdfColumn = {
	label: string;
	/** Right for amounts and other numbers; default left. */
	align?: 'left' | 'right';
	/** Fraction of the text width (0–1). Columns without a width share what is left equally. */
	width?: number;
};

export type PdfTable = {
	columns: PdfColumn[];
	rows: string[][];
	/** A sum row, bold under a rule. */
	footer?: string[];
	/** Bold line above the header row. */
	title?: string;
};

export type LetterBlock = { paragraph: string } | { table: PdfTable };

export type Letter = {
	/** Name and address of the landlord; the first line is also the small sender line above the window. */
	sender: string[];
	recipient: string[];
	/** Already formatted, e.g. `Berlin, 15.03.2026`. */
	date: string;
	subject: string;
	/** Each may contain line breaks. */
	paragraphs: string[];
	/** Rendered after the paragraphs, in order. */
	tables?: PdfTable[];
	/** Paragraphs and tables in an explicit order; replaces `paragraphs` and `tables` when given. */
	blocks?: LetterBlock[];
	/** E.g. `['Mit freundlichen Grüßen', '', 'Erika Vermieter']`. */
	closing?: string[];
};

// A4 in PDF points (1 pt = 1/72 inch).
const MM = 72 / 25.4;
const PAGE_WIDTH = 210 * MM;
const PAGE_HEIGHT = 297 * MM;
const MARGIN_LEFT = 20 * MM;
const MARGIN_RIGHT = 20 * MM;
const MARGIN_TOP = 25 * MM;
const MARGIN_BOTTOM = 20 * MM;
const TEXT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

const BODY_SIZE = 10.5;
const SMALL_SIZE = 7.5;
const LINE_HEIGHT = 14;
// Where the baseline sits in a line box, as a share of the line height.
const BASELINE = 0.75;

// DIN 5008 form B, measured from the top edge: the address field is 45–90 mm, its first 5 mm hold
// the sender line, and the subject starts about 98.5 mm down.
const SENDER_LINE_TOP = 45 * MM;
const RECIPIENT_TOP = 50 * MM;
const SUBJECT_TOP = 98.5 * MM;
const FOOTER_BASELINE = 10 * MM;

const CELL_PADDING_X = 3;
const CELL_PADDING_Y = 2.5;
const RULE_THICKNESS = 0.5;
const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.4, 0.4, 0.4);

// WinAnsi covers ASCII, Latin-1 and these 27 characters in its 0x80–0x9F block.
const WIN_ANSI_EXTRA = 'ŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™';

// Close ASCII forms for characters a letter is likely to contain but WinAnsi has no glyph for
// (subscript digits as in CO₂, the figure dash, the minus sign), plus the em dash and the ellipsis,
// which are replaced as the design asks even though WinAnsi could encode them. Tabs become a
// space; a carriage return disappears so CRLF text wraps like LF text.
const REPLACEMENTS: Record<string, string> = {
	'₀': '0',
	'₁': '1',
	'₂': '2',
	'₃': '3',
	'₄': '4',
	'₅': '5',
	'₆': '6',
	'₇': '7',
	'₈': '8',
	'₉': '9',
	'⁰': '0',
	'⁴': '4',
	'⁵': '5',
	'⁶': '6',
	'⁷': '7',
	'⁸': '8',
	'⁹': '9',
	'‒': '-',
	'—': '-',
	'−': '-',
	'…': '...',
	'\t': ' ',
	'\r': ''
};

function canEncode(char: string): boolean {
	const code = char.codePointAt(0) ?? 0;
	return (
		(code >= 0x20 && code <= 0x7e) ||
		(code >= 0xa0 && code <= 0xff) ||
		WIN_ANSI_EXTRA.includes(char)
	);
}

/**
 * Makes `text` drawable with a standard font: characters WinAnsi cannot encode become a close
 * ASCII form (`CO₂` → `CO2`) or `?`. Line breaks are kept; the caller wraps on them.
 */
export function toWinAnsi(text: string): string {
	let out = '';
	for (const char of text) {
		const replacement = REPLACEMENTS[char];
		if (replacement !== undefined) out += replacement;
		else if (char === '\n' || canEncode(char)) out += char;
		else out += '?';
	}
	return out;
}

type Cursor = {
	page: PDFPage;
	/** Top of the next line box, in points from the bottom edge. */
	y: number;
	/** Where the content of this page started; the cursor is "at the top" while it is still here. */
	top: number;
};

type Context = {
	doc: PDFDocument;
	regular: PDFFont;
	bold: PDFFont;
	cursor: Cursor;
};

type TextOptions = {
	x: number;
	/** The baseline. */
	y: number;
	font: PDFFont;
	size?: number;
	/** With `right`, `x` is the right edge of the text. */
	align?: 'left' | 'right';
	color?: ReturnType<typeof rgb>;
};

function textWidth(font: PDFFont, size: number, text: string): number {
	return font.widthOfTextAtSize(toWinAnsi(text), size);
}

/** Draws one physical line; line breaks in `text` become spaces. */
function drawText(page: PDFPage, text: string, options: TextOptions): void {
	const clean = toWinAnsi(text).replaceAll('\n', ' ');
	const size = options.size ?? BODY_SIZE;
	const x =
		options.align === 'right' ? options.x - options.font.widthOfTextAtSize(clean, size) : options.x;
	page.drawText(clean, {
		x,
		y: options.y,
		font: options.font,
		size,
		color: options.color ?? BLACK
	});
}

function drawRule(page: PDFPage, y: number): void {
	page.drawLine({
		start: { x: MARGIN_LEFT, y },
		end: { x: MARGIN_LEFT + TEXT_WIDTH, y },
		thickness: RULE_THICKNESS,
		color: GREY
	});
}

/** Splits a word wider than `width` into pieces that fit; the last piece may be short. */
function cutWord(font: PDFFont, size: number, word: string, width: number): string[] {
	const pieces: string[] = [];
	let piece = '';
	for (const char of word) {
		if (piece && textWidth(font, size, piece + char) > width) {
			pieces.push(piece);
			piece = '';
		}
		piece += char;
	}
	pieces.push(piece);
	return pieces;
}

/** Breaks `text` at spaces (and at its own line breaks) into lines no wider than `width`. */
function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
	const lines: string[] = [];
	for (const raw of toWinAnsi(text).split('\n')) {
		let line = '';
		for (const word of raw.split(' ')) {
			const candidate = line ? `${line} ${word}` : word;
			if (textWidth(font, size, candidate) <= width) {
				line = candidate;
				continue;
			}
			if (line) lines.push(line);
			// The word alone does not fit next to the line; it may not even fit on a line of its own.
			const pieces = cutWord(font, size, word, width);
			lines.push(...pieces.slice(0, -1));
			line = pieces[pieces.length - 1];
		}
		lines.push(line);
	}
	return lines;
}

function newPage(ctx: Context): void {
	const page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
	ctx.cursor = { page, y: PAGE_HEIGHT - MARGIN_TOP, top: PAGE_HEIGHT - MARGIN_TOP };
}

function fits(ctx: Context, height: number): boolean {
	return ctx.cursor.y - height >= MARGIN_BOTTOM;
}

/** Starts a new page unless `height` still fits, or the page is empty and nothing would fit better. */
function ensureSpace(ctx: Context, height: number): void {
	if (!fits(ctx, height) && ctx.cursor.y < ctx.cursor.top) newPage(ctx);
}

/** Writes one line at the cursor and moves it down; an empty string leaves a blank line. */
function writeLine(ctx: Context, text: string, font: PDFFont): void {
	ensureSpace(ctx, LINE_HEIGHT);
	if (text) {
		drawText(ctx.cursor.page, text, {
			x: MARGIN_LEFT,
			y: ctx.cursor.y - LINE_HEIGHT * BASELINE,
			font
		});
	}
	ctx.cursor.y -= LINE_HEIGHT;
}

function writeParagraph(ctx: Context, text: string, font: PDFFont): void {
	for (const line of wrap(font, BODY_SIZE, text, TEXT_WIDTH)) writeLine(ctx, line, font);
	ctx.cursor.y -= LINE_HEIGHT;
}

/** Column widths in points. Fractions that add up to more than 1 are scaled down to the text width. */
function columnWidths(columns: PdfColumn[]): number[] {
	const given = columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
	const missing = columns.filter((column) => column.width === undefined).length;
	const share = missing ? Math.max(0, 1 - given) / missing : 0;
	const scale = TEXT_WIDTH / Math.max(1, given);
	return columns.map((column) => (column.width ?? share) * scale);
}

type Row = {
	/** The wrapped lines of each cell. */
	cells: string[][];
	height: number;
};

function layoutRow(cells: string[], widths: number[], font: PDFFont): Row {
	const wrapped = widths.map((width, index) =>
		wrap(font, BODY_SIZE, cells[index] ?? '', Math.max(1, width - 2 * CELL_PADDING_X))
	);
	const lines = Math.max(1, ...wrapped.map((cell) => cell.length));
	return { cells: wrapped, height: lines * LINE_HEIGHT + 2 * CELL_PADDING_Y };
}

/** Draws a laid-out row at the cursor; the caller has made sure it fits. */
function drawRow(ctx: Context, row: Row, columns: PdfColumn[], widths: number[], font: PDFFont) {
	const { page, y: top } = ctx.cursor;
	let left = MARGIN_LEFT;
	row.cells.forEach((lines, index) => {
		const right = columns[index].align === 'right';
		lines.forEach((line, lineIndex) => {
			drawText(page, line, {
				x: right ? left + widths[index] - CELL_PADDING_X : left + CELL_PADDING_X,
				y: top - CELL_PADDING_Y - lineIndex * LINE_HEIGHT - LINE_HEIGHT * BASELINE,
				font,
				align: right ? 'right' : 'left'
			});
		});
		left += widths[index];
	});
	ctx.cursor.y -= row.height;
}

function writeTable(ctx: Context, table: PdfTable): void {
	const widths = columnWidths(table.columns);
	const labels = table.columns.map((column) => column.label);
	const header = layoutRow(labels, widths, ctx.bold);
	const rows = table.rows.map((cells) => layoutRow(cells, widths, ctx.regular));
	const footer = table.footer ? layoutRow(table.footer, widths, ctx.bold) : undefined;

	const drawHeader = () => {
		drawRow(ctx, header, table.columns, widths, ctx.bold);
		drawRule(ctx.cursor.page, ctx.cursor.y);
	};

	// The title, the header and the first row stay together.
	const titleHeight = table.title ? LINE_HEIGHT : 0;
	ensureSpace(ctx, titleHeight + header.height + (rows[0]?.height ?? footer?.height ?? 0));
	if (table.title) writeLine(ctx, table.title, ctx.bold);
	drawHeader();

	for (const row of rows) {
		if (!fits(ctx, row.height)) {
			newPage(ctx);
			drawHeader();
		}
		drawRow(ctx, row, table.columns, widths, ctx.regular);
	}

	if (footer) {
		if (!fits(ctx, footer.height)) {
			newPage(ctx);
			drawHeader();
		}
		drawRule(ctx.cursor.page, ctx.cursor.y);
		drawRow(ctx, footer, table.columns, widths, ctx.bold);
	}
	ctx.cursor.y -= LINE_HEIGHT;
}

/** Sender, window field, date and subject of the first page; leaves the cursor below the subject. */
function writeLetterhead(ctx: Context, letter: Letter): void {
	const { page } = ctx.cursor;
	const right = MARGIN_LEFT + TEXT_WIDTH;

	// The full sender address at the top right, where a letterhead would be.
	let y = PAGE_HEIGHT - MARGIN_TOP;
	for (const line of letter.sender) {
		drawText(page, line, {
			x: right,
			y: y - LINE_HEIGHT * BASELINE,
			font: ctx.regular,
			align: 'right'
		});
		y -= LINE_HEIGHT;
	}

	// The sender line in the top 5 mm of the window, as on a return address.
	if (letter.sender[0]) {
		drawText(page, letter.sender[0], {
			x: MARGIN_LEFT,
			y: PAGE_HEIGHT - SENDER_LINE_TOP - SMALL_SIZE,
			font: ctx.regular,
			size: SMALL_SIZE,
			color: GREY
		});
	}

	y = PAGE_HEIGHT - RECIPIENT_TOP;
	drawText(page, letter.date, {
		x: right,
		y: y - LINE_HEIGHT * BASELINE,
		font: ctx.regular,
		align: 'right'
	});
	for (const line of letter.recipient) {
		drawText(page, line, { x: MARGIN_LEFT, y: y - LINE_HEIGHT * BASELINE, font: ctx.regular });
		y -= LINE_HEIGHT;
	}

	// The subject at its DIN position, or lower when the recipient block is unusually long.
	ctx.cursor.y = Math.min(PAGE_HEIGHT - SUBJECT_TOP, y - LINE_HEIGHT);
	ctx.cursor.top = ctx.cursor.y;
	writeParagraph(ctx, letter.subject, ctx.bold);
}

function writeFooters(ctx: Context): void {
	const pages = ctx.doc.getPages();
	pages.forEach((page, index) => {
		const label = `Seite ${index + 1} von ${pages.length}`;
		const width = ctx.regular.widthOfTextAtSize(label, SMALL_SIZE);
		drawText(page, label, {
			x: (PAGE_WIDTH - width) / 2,
			y: FOOTER_BASELINE,
			font: ctx.regular,
			size: SMALL_SIZE,
			color: GREY
		});
	});
}

function blocksOf(letter: Letter): LetterBlock[] {
	if (letter.blocks) return letter.blocks;
	return [
		...letter.paragraphs.map((paragraph) => ({ paragraph })),
		...(letter.tables ?? []).map((table) => ({ table }))
	];
}

/** Renders the letter as A4 pages and returns the PDF bytes. */
export async function renderLetter(letter: Letter): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.setTitle(letter.subject);
	doc.setLanguage('de-DE');
	doc.setCreator('mietkartei');
	doc.setProducer('mietkartei');
	const regular = await doc.embedFont(StandardFonts.Helvetica);
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);

	const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
	const ctx: Context = { doc, regular, bold, cursor: { page, y: 0, top: 0 } };
	writeLetterhead(ctx, letter);

	for (const block of blocksOf(letter)) {
		if ('paragraph' in block) writeParagraph(ctx, block.paragraph, regular);
		else writeTable(ctx, block.table);
	}

	if (letter.closing?.length) {
		// The greeting and the signature are not torn apart by a page break.
		ensureSpace(ctx, letter.closing.length * LINE_HEIGHT);
		for (const line of letter.closing) writeLine(ctx, line, regular);
	}

	writeFooters(ctx);
	return doc.save();
}

export type Report = {
	/** Bold at the top of the first page. */
	title: string;
	/** Smaller lines under the title, e.g. who and what the report is about. */
	subtitle: string[];
	blocks: LetterBlock[];
};

/** Renders a report: like a letter, but with a title in place of the address field. */
export async function renderReport(report: Report): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.setTitle(report.title);
	doc.setLanguage('de-DE');
	doc.setCreator('mietkartei');
	doc.setProducer('mietkartei');
	const regular = await doc.embedFont(StandardFonts.Helvetica);
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);

	const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
	const top = PAGE_HEIGHT - MARGIN_TOP;
	const ctx: Context = { doc, regular, bold, cursor: { page, y: top, top } };
	writeParagraph(ctx, report.title, bold);
	for (const line of report.subtitle) writeLine(ctx, line, regular);
	if (report.subtitle.length) ctx.cursor.y -= LINE_HEIGHT;
	for (const block of report.blocks) {
		if ('paragraph' in block) writeParagraph(ctx, block.paragraph, regular);
		else writeTable(ctx, block.table);
	}
	writeFooters(ctx);
	return doc.save();
}

// German umlauts keep their sound in the ASCII fallback of a file name.
const TRANSLITERATIONS: Record<string, string> = {
	ä: 'ae',
	ö: 'oe',
	ü: 'ue',
	Ä: 'Ae',
	Ö: 'Oe',
	Ü: 'Ue',
	ß: 'ss'
};

/** `Abrechnung Müller 2025.pdf` → `Abrechnung Mueller 2025.pdf`; anything else non-ASCII becomes `_`. */
function asciiFilename(filename: string): string {
	return filename
		.replace(/[äöüÄÖÜß]/g, (char) => TRANSLITERATIONS[char])
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/[^A-Za-z0-9 ._-]/g, '_');
}

/** The response of a download route: shown inline by the browser, saved under `filename`. */
export function pdfResponse(bytes: Uint8Array, filename: string): Response {
	const fallback = asciiFilename(filename);
	const encoded = encodeURIComponent(filename);
	return new Response(bytes as Uint8Array<ArrayBuffer>, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`,
			'Cache-Control': 'private, no-store',
			// The app shows it in a frame of its preview dialog (PreviewLink).
			'X-Frame-Options': 'SAMEORIGIN'
		}
	});
}
