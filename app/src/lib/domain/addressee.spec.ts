import { describe, expect, it } from 'vitest';
import { addressee, addresseeLine, greeting, leaseTenantName, mainFirst } from './addressee';

const erika = { salutation: 'Frau', firstName: 'Erika', lastName: 'Muster' };
const max = { salutation: 'Herr', firstName: 'Max', lastName: 'Muster' };
const kim = { salutation: null, firstName: 'Kim', lastName: 'Test' };

describe('addressee', () => {
	it('names the family when every tenant has the same last name', () => {
		expect(addressee([erika, { ...max, lastName: ' muster ' }])).toEqual({
			family: 'Muster',
			tenant: erika
		});
		expect(leaseTenantName([erika, max])).toBe('Familie Muster');
		expect(addresseeLine([erika, max])).toBe('Familie Muster');
		expect(greeting([erika, max])).toBe('Guten Tag Familie Muster,');
	});

	it('names only the main tenant, who comes first, when the last names differ', () => {
		expect(addressee([kim, erika])).toEqual({ family: null, tenant: kim });
		expect(leaseTenantName([kim, erika])).toBe('Kim Test');
		expect(addresseeLine([erika, kim])).toBe('Frau Erika Muster');
		expect(addresseeLine([kim, erika])).toBe('Kim Test');
		expect(greeting([max, kim])).toBe('Guten Tag Herr Muster,');
		expect(greeting([kim, max])).toBe('Guten Tag Kim Test,');
	});

	it('names a single tenant without "Familie", and nobody for none', () => {
		expect(leaseTenantName([erika])).toBe('Erika Muster');
		expect(greeting([erika])).toBe('Guten Tag Frau Muster,');
		expect(addressee([])).toBeUndefined();
		expect(leaseTenantName([])).toBe('');
		expect(addresseeLine([])).toBeUndefined();
		expect(greeting([])).toBe('Guten Tag,');
	});

	it('does not make a family of tenants without a last name', () => {
		const first = { salutation: null, firstName: 'Anna', lastName: '' };
		expect(addressee([first, { ...first, firstName: 'Ben' }])?.family).toBeNull();
	});
});

describe('mainFirst', () => {
	const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

	it('puts the main tenant first and keeps the order of the others', () => {
		expect(mainFirst(rows, 'c', (row) => row.id).map((row) => row.id)).toEqual(['c', 'a', 'b']);
	});

	it('keeps the order when there is no main tenant or it is not among them', () => {
		expect(mainFirst(rows, null, (row) => row.id).map((row) => row.id)).toEqual(['a', 'b', 'c']);
		expect(mainFirst(rows, 'x', (row) => row.id).map((row) => row.id)).toEqual(['a', 'b', 'c']);
	});
});
