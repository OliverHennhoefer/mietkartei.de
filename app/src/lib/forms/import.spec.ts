import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import { IMPORT_MAX_BYTES, parseImportForm } from './import';

const csv = new File(['Objekt;Einheit\nHaus;EG\n'], 'export.csv', { type: 'text/csv' });

describe('parseImportForm', () => {
	it('accepts the kind and the file of step 1', () => {
		const result = parseImportForm(formDataOf({ kind: 'properties', file: csv }));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.kind).toBe('properties');
		expect(result.data.file?.name).toBe('export.csv');
		expect(result.data.content).toBeNull();
		// Step 1 has no selects: every field is unmapped until the proposal fills it in.
		expect(Object.values(result.data.mapping).every((column) => column === null)).toBe(true);
	});

	it('accepts the content and the mapping of step 2', () => {
		const result = parseImportForm(
			formDataOf({
				kind: 'tenants',
				content: 'Vm9ybmFtZTtOYWNobmFtZQ==',
				'map.firstName': '0',
				'map.lastName': '1',
				'map.email': ''
			})
		);
		expect(result).toMatchObject({
			ok: true,
			data: {
				kind: 'tenants',
				file: null,
				content: 'Vm9ybmFtZTtOYWNobmFtZQ==',
				mapping: { firstName: 0, lastName: 1, email: null, phone: null, notes: null }
			}
		});
	});

	it('needs a file or the content', () => {
		const result = parseImportForm(formDataOf({ kind: 'payments' }));
		expect(result).toMatchObject({
			ok: false,
			errors: { file: 'Bitte wähle eine CSV-Datei aus.' }
		});
	});

	it('refuses an unknown kind and a mapping that is not a column index', () => {
		expect(parseImportForm(formDataOf({ kind: 'bananas', file: csv }))).toMatchObject({
			ok: false,
			errors: { kind: 'Bitte wähle einen gültigen Eintrag aus.' }
		});
		expect(
			parseImportForm(formDataOf({ kind: 'leases', content: 'YQ==', 'map.baseRent': '-1' }))
		).toMatchObject({ ok: false, errors: { mapping: 'Die Spaltenzuordnung ist ungültig.' } });
	});

	it('refuses a file or content over the size limit', () => {
		const big = new File([new Uint8Array(IMPORT_MAX_BYTES + 1)], 'big.csv');
		const tooLarge = { ok: false, errors: { file: 'Die Datei ist zu groß (höchstens 2 MB).' } };
		expect(parseImportForm(formDataOf({ kind: 'properties', file: big }))).toMatchObject(tooLarge);
		const content = 'A'.repeat(4 * IMPORT_MAX_BYTES + 4);
		expect(parseImportForm(formDataOf({ kind: 'properties', content }))).toMatchObject(tooLarge);
	});
});
