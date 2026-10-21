import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import { parseTenant } from './tenants';

const complete = {
	salutation: 'Frau',
	firstName: ' Erika ',
	lastName: 'Mustermann',
	email: 'Erika.Mustermann@Example.org',
	phone: '030 1234567',
	street: 'Lindenstraße 4',
	postalCode: '10115',
	city: 'Berlin',
	notes: 'Zahlt per Dauerauftrag.'
};

function parse(overrides: Record<string, string> = {}) {
	return parseTenant(formDataOf({ ...complete, ...overrides }));
}

describe('parseTenant', () => {
	it('accepts a complete tenant, trims names and lower-cases the address', () => {
		expect(parse()).toEqual({
			ok: true,
			data: {
				salutation: 'Frau',
				firstName: 'Erika',
				lastName: 'Mustermann',
				email: 'erika.mustermann@example.org',
				phone: '030 1234567',
				street: 'Lindenstraße 4',
				postalCode: '10115',
				city: 'Berlin',
				notes: 'Zahlt per Dauerauftrag.'
			}
		});
	});

	it('needs only the names; everything else becomes null', () => {
		const result = parseTenant(formDataOf({ firstName: 'Max', lastName: 'Mustermann' }));
		expect(result).toEqual({
			ok: true,
			data: {
				salutation: null,
				firstName: 'Max',
				lastName: 'Mustermann',
				email: null,
				phone: null,
				street: null,
				postalCode: null,
				city: null,
				notes: null
			}
		});
	});

	it('requires both names and limits their length', () => {
		const missing = parse({ firstName: '', lastName: ' ' });
		expect(missing.ok).toBe(false);
		if (missing.ok) return;
		expect(missing.errors).toEqual({
			firstName: 'Bitte fülle dieses Feld aus.',
			lastName: 'Bitte fülle dieses Feld aus.'
		});

		const long = parse({ firstName: 'x'.repeat(101), lastName: 'y'.repeat(101) });
		expect(long.ok).toBe(false);
		if (long.ok) return;
		expect(long.errors).toEqual({
			firstName: 'Höchstens 100 Zeichen.',
			lastName: 'Höchstens 100 Zeichen.'
		});
	});

	it('rejects an invalid email address and a postal code without five digits', () => {
		const result = parse({ email: 'erika@', postalCode: '1011' });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual({
			email: 'Bitte gib eine gültige E-Mail-Adresse an.',
			postalCode: 'Die Postleitzahl hat fünf Ziffern.'
		});
		expect(result.values.email).toBe('erika@');
		expect(result.values.postalCode).toBe('1011');
	});

	it('limits salutation, phone and notes', () => {
		const result = parse({
			salutation: 's'.repeat(51),
			phone: '0'.repeat(51),
			notes: 'n'.repeat(2001)
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual({
			salutation: 'Höchstens 50 Zeichen.',
			phone: 'Höchstens 50 Zeichen.',
			notes: 'Höchstens 2000 Zeichen.'
		});
	});
});
