import { describe, expect, it } from 'vitest';
import { MAX_LETTER_PARAGRAPHS, MAX_PARAGRAPH_LENGTH, letterText } from './letters';

describe('letterText', () => {
	it('joins the paragraphs by blank lines and keeps single line breaks', () => {
		expect(letterText(['Guten Tag,', 'Zeile eins\nZeile zwei', 'Danke.'], 2)).toEqual({
			ok: true,
			text: 'Guten Tag,\n\nZeile eins\nZeile zwei\n\nDanke.'
		});
	});

	it('cleans what a text field hands over, keeps no-break spaces and a paragraph whole', () => {
		expect(letterText([' Guten Tag, \r\n', 'eins\n\n\n1.300,00\u00a0€  \nvier'], 1)).toEqual({
			ok: true,
			text: 'Guten Tag,\n\neins\n1.300,00\u00a0€\nvier'
		});
	});

	it('drops an emptied paragraph after the required ones', () => {
		expect(letterText(['Guten Tag,', 'Offen ist:', '  ', 'Danke.'], 2)).toEqual({
			ok: true,
			text: 'Guten Tag,\n\nOffen ist:\n\nDanke.'
		});
	});

	it('refuses an emptied required paragraph, a missing text and too much text', () => {
		expect(letterText(['Guten Tag,', ' '], 2)).toMatchObject({ ok: false });
		expect(letterText(['Guten Tag,'], 2)).toMatchObject({ ok: false });
		expect(letterText([''], 1)).toMatchObject({ ok: false });
		expect(letterText('Guten Tag', 1)).toMatchObject({ ok: false });
		expect(letterText([1], 1)).toMatchObject({ ok: false });
		expect(letterText(Array(MAX_LETTER_PARAGRAPHS + 1).fill('Absatz'), 1)).toMatchObject({
			ok: false
		});
		expect(letterText(['x'.repeat(MAX_PARAGRAPH_LENGTH + 1)], 1)).toMatchObject({ ok: false });
	});
});
