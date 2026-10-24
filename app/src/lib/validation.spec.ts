import { describe, expect, it } from 'vitest';
import { parseCredentials, parseProperty, parseUnit } from './validation';

function form(entries: Record<string, string>) {
	const data = new FormData();
	for (const [name, value] of Object.entries(entries)) data.set(name, value);
	return data;
}

describe('parseProperty', () => {
	it('accepts a complete address, trims whitespace and takes the defaults for the rest', () => {
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
				city: 'Berlin',
				buildingUse: 'residential',
				state: null,
				vacancyPersons: 1,
				notes: null
			}
		});
	});

	it('reads building use, Bundesland, vacancy persons and notes', () => {
		const result = parseProperty(
			form({
				name: 'Gewerbehof',
				street: 'Am Markt 1',
				postalCode: '04109',
				city: 'Leipzig',
				buildingUse: 'non_residential',
				state: 'SN',
				vacancyPersons: '0',
				notes: ' Hinterhof '
			})
		);
		expect(result).toEqual({
			ok: true,
			data: {
				name: 'Gewerbehof',
				street: 'Am Markt 1',
				postalCode: '04109',
				city: 'Leipzig',
				buildingUse: 'non_residential',
				state: 'SN',
				vacancyPersons: 0,
				notes: 'Hinterhof'
			}
		});
	});

	it('reports every missing or invalid field', () => {
		const result = parseProperty(
			form({
				name: '',
				street: '',
				postalCode: '1011',
				city: '',
				buildingUse: 'castle',
				state: 'XX',
				vacancyPersons: '11'
			})
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(Object.keys(result.errors).sort()).toEqual([
			'buildingUse',
			'city',
			'name',
			'postalCode',
			'state',
			'street',
			'vacancyPersons'
		]);
		expect(result.errors.postalCode).toBe('Die Postleitzahl hat fünf Ziffern.');
		expect(result.values.postalCode).toBe('1011');
	});

	it('rejects a fractional vacancy count', () => {
		const result = parseProperty(
			form({
				name: 'Haus',
				street: 'Am Markt 1',
				postalCode: '04109',
				city: 'Leipzig',
				vacancyPersons: '1,5'
			})
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(Object.keys(result.errors)).toEqual(['vacancyPersons']);
	});
});

describe('parseUnit', () => {
	it('accepts a German decimal comma for the floor area and rooms', () => {
		const result = parseUnit(
			form({
				name: 'EG links',
				kind: 'apartment',
				floorArea: '72,5',
				floor: 'EG',
				rooms: '2,5',
				notes: 'Garten'
			})
		);
		expect(result).toEqual({
			ok: true,
			data: {
				name: 'EG links',
				kind: 'apartment',
				floorArea: 72.5,
				floor: 'EG',
				rooms: 2.5,
				notes: 'Garten'
			}
		});
	});

	it('reads a decimal point as one', () => {
		const result = parseUnit(
			form({ name: 'EG links', kind: 'apartment', floorArea: '72.5', rooms: '2.5' })
		);
		expect(result.ok && result.data).toMatchObject({ floorArea: 72.5, rooms: 2.5 });
	});

	it('treats empty optional fields as unknown', () => {
		const result = parseUnit(form({ name: 'Stellplatz 3', kind: 'parking', floorArea: '' }));
		expect(result).toEqual({
			ok: true,
			data: {
				name: 'Stellplatz 3',
				kind: 'parking',
				floorArea: null,
				floor: null,
				rooms: null,
				notes: null
			}
		});
	});

	it('rejects unknown kinds and invalid areas or rooms', () => {
		const result = parseUnit(
			form({ name: 'Keller', kind: 'cellar', floorArea: '-3', rooms: 'drei' })
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(Object.keys(result.errors).sort()).toEqual(['floorArea', 'kind', 'rooms']);
		expect(result.errors.floorArea).toBe('Bitte gib die Fläche als positive Zahl in m² an.');
	});

	it('rejects a floor area of zero', () => {
		const result = parseUnit(form({ name: 'Keller', kind: 'apartment', floorArea: '0' }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(Object.keys(result.errors)).toEqual(['floorArea']);
	});
});

describe('length limits', () => {
	const long = (length: number) => 'x'.repeat(length);

	it('refuses names and addresses longer than the database keeps', () => {
		const result = parseProperty(
			form({ name: long(101), street: long(201), postalCode: '10115', city: long(101) })
		);
		expect(result).toMatchObject({
			ok: false,
			errors: {
				name: 'Die Bezeichnung ist zu lang.',
				street: 'Höchstens 200 Zeichen.',
				city: 'Höchstens 100 Zeichen.'
			}
		});
		expect(parseUnit(form({ name: long(101), kind: 'apartment' }))).toMatchObject({
			ok: false,
			errors: { name: 'Die Bezeichnung ist zu lang.' }
		});
	});

	it('refuses a password longer than 200 characters and never sends it back', () => {
		const result = parseCredentials(form({ email: 'a@example.org', password: long(201) }));
		expect(result).toMatchObject({ ok: false, errors: { password: 'Das Passwort ist zu lang.' } });
		expect(JSON.stringify(result)).not.toContain(long(201));
		expect(parseCredentials(new FormData())).toMatchObject({
			ok: false,
			errors: { email: expect.any(String), password: expect.any(String) }
		});
	});
});
