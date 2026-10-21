import { describe, expect, it } from 'vitest';
import { FormParser } from './fields';

type Sample = {
	name: string;
	note: string | null;
	area: number | null;
	count: number;
	kind: 'a' | 'b';
};

function formData(entries: Record<string, string>): FormData {
	const data = new FormData();
	for (const [name, value] of Object.entries(entries)) data.set(name, value);
	return data;
}

function parse(entries: Record<string, string>) {
	const parser = new FormParser<Sample>(formData(entries));
	const name = parser.text('name', { max: 10 });
	const note = parser.optionalText('note');
	const area = parser.number('area', { required: false });
	const count = parser.number('count', { integer: true, max: 10 });
	const kind = parser.oneOf('kind', ['a', 'b'] as const);
	return parser.result(() => ({ name, note, area, count: count!, kind: kind! }));
}

describe('FormParser', () => {
	it('parses every field type', () => {
		const result = parse({ name: ' Haus ', note: '', area: '1.072,5', count: '3', kind: 'b' });
		expect(result).toEqual({
			ok: true,
			data: { name: 'Haus', note: null, area: 1072.5, count: 3, kind: 'b' }
		});
	});

	it('reads a dot as the decimal point when there is no comma', () => {
		const result = parse({ name: 'Haus', area: '72.5', count: '3', kind: 'a' });
		expect(result.ok && result.data.area).toBe(72.5);
	});

	it('collects one error per field and echoes the values', () => {
		const result = parse({ name: 'viel zu langer Name', area: 'x', count: '2,5', kind: 'c' });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual({
			name: 'Höchstens 10 Zeichen.',
			area: 'Bitte gib eine Zahl an.',
			count: 'Bitte gib eine ganze Zahl an.',
			kind: 'Bitte wähle einen gültigen Eintrag aus.'
		});
		expect(result.values).toMatchObject({ name: 'viel zu langer Name', area: 'x', note: '' });
	});

	it('reports missing required fields and values out of range', () => {
		const missing = parse({ name: '', count: '', kind: '' });
		expect(missing.ok).toBe(false);
		if (missing.ok) return;
		expect(missing.errors).toEqual({
			name: 'Bitte fülle dieses Feld aus.',
			count: 'Bitte gib eine Zahl an.',
			kind: 'Bitte wähle einen Eintrag aus.'
		});

		const range = parse({ name: 'Haus', area: '-1', count: '11', kind: 'a' });
		expect(range.ok).toBe(false);
		if (range.ok) return;
		expect(range.errors).toEqual({
			area: 'Der Wert darf nicht unter 0 liegen.',
			count: 'Der Wert darf nicht über 10 liegen.'
		});
	});
});
