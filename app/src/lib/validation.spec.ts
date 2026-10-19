import { describe, expect, it } from 'vitest';
import { parseProperty, parseUnit } from './validation';

function form(entries: Record<string, string>) {
	const data = new FormData();
	for (const [name, value] of Object.entries(entries)) data.set(name, value);
	return data;
}

describe('parseProperty', () => {
	it('accepts a complete address and trims whitespace', () => {
		const result = parseProperty(
			form({
				name: ' Lindenstraße 4 ',
				street: 'Lindenstraße 4',
				postalCode: '10115',
				city: 'Berlin'
			})
		);
		expect(result).toEqual({
			ok: true,
			data: {
				name: 'Lindenstraße 4',
				street: 'Lindenstraße 4',
				postalCode: '10115',
				city: 'Berlin'
			}
		});
	});

	it('reports every missing or invalid field', () => {
		const result = parseProperty(form({ name: '', street: '', postalCode: '1011', city: '' }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(Object.keys(result.errors).sort()).toEqual(['city', 'name', 'postalCode', 'street']);
		expect(result.values.postalCode).toBe('1011');
	});
});

describe('parseUnit', () => {
	it('accepts a German decimal comma for the floor area', () => {
		const result = parseUnit(form({ name: 'EG links', kind: 'apartment', floorArea: '72,5' }));
		expect(result).toEqual({
			ok: true,
			data: { name: 'EG links', kind: 'apartment', floorArea: 72.5 }
		});
	});

	it('treats an empty floor area as unknown', () => {
		const result = parseUnit(form({ name: 'Stellplatz 3', kind: 'parking', floorArea: '' }));
		expect(result).toEqual({
			ok: true,
			data: { name: 'Stellplatz 3', kind: 'parking', floorArea: null }
		});
	});

	it('rejects unknown kinds and invalid areas', () => {
		const result = parseUnit(form({ name: 'Keller', kind: 'cellar', floorArea: '-3' }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(Object.keys(result.errors).sort()).toEqual(['floorArea', 'kind']);
	});
});
