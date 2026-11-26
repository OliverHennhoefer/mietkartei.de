// Letters: the shape pdf.ts renders and the preview dialog shows, and the text of a stored letter
// (Zahlungserinnerung, Mahnung, Mieterhöhung) as edited on its sheet in the preview dialog:
// paragraphs, stored joined by blank lines like the generated text. Kept apart from pdf.ts, so
// the browser and the statement tool do not load pdf-lib.

import type { GiroCode } from './girocode';

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

export type LetterBlock = { paragraph: string } | { table: PdfTable } | { giroCode: GiroCode };

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
	/** An Anlage on a page of its own after the closing, under a bold title. */
	appendix?: { title: string; blocks: LetterBlock[] };
};

/** The paragraphs and tables in the order they are rendered: `blocks`, or else the paragraphs, then the tables. */
export function blocksOf(letter: Letter): LetterBlock[] {
	if (letter.blocks) return letter.blocks;
	return [
		...letter.paragraphs.map((paragraph) => ({ paragraph })),
		...(letter.tables ?? []).map((table) => ({ table }))
	];
}

export const MAX_LETTER_PARAGRAPHS = 30;
export const MAX_PARAGRAPH_LENGTH = 4000;

export type LetterTextResult = { ok: true; text: string } | { ok: false; message: string };

/**
 * Checks and joins edited paragraphs. A paragraph keeps single line breaks; blank lines inside it
 * would split it, so they become one break. An emptied paragraph is dropped, except the first
 * `required`, which the layout places something after (the table of a Mahnung follows the second).
 */
export function letterText(paragraphs: unknown, required: number): LetterTextResult {
	if (
		!Array.isArray(paragraphs) ||
		!paragraphs.every((paragraph) => typeof paragraph === 'string')
	) {
		return { ok: false, message: 'Der Text des Schreibens fehlt.' };
	}
	const cleaned = paragraphs.map((paragraph: string) =>
		paragraph
			.replaceAll('\r', '')
			.split('\n')
			.map((line) => line.trimEnd())
			.join('\n')
			.replace(/\n{2,}/g, '\n')
			.trim()
	);
	if (cleaned.slice(0, required).some((paragraph) => !paragraph) || cleaned.length < required) {
		return {
			ok: false,
			message:
				required > 1
					? `Die ersten ${required} Absätze dürfen nicht leer sein.`
					: 'Der erste Absatz darf nicht leer sein.'
		};
	}
	const kept = cleaned.filter(Boolean);
	if (kept.length > MAX_LETTER_PARAGRAPHS) {
		return { ok: false, message: `Höchstens ${MAX_LETTER_PARAGRAPHS} Absätze.` };
	}
	if (kept.some((paragraph) => paragraph.length > MAX_PARAGRAPH_LENGTH)) {
		return {
			ok: false,
			message: `Ein Absatz darf höchstens ${MAX_PARAGRAPH_LENGTH} Zeichen lang sein.`
		};
	}
	return { ok: true, text: kept.join('\n\n') };
}
