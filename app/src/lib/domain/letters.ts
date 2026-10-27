// The text of a stored letter (Zahlungserinnerung, Mahnung, Mieterhöhung) as edited on its sheet
// in the preview dialog: paragraphs, stored joined by blank lines like the generated text.

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
