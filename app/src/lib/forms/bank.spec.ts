import { describe, expect, it } from 'vitest';
import { formatCents } from '../money';
import {
	mappingError,
	parseAssignment,
	parseBankAccount,
	parseImport,
	parseRule,
	toColumnMapping
} from './bank';
import { formDataOf } from './fields';

describe('parseBankAccount', () => {
	it('stores the IBAN without spaces and the BIC in upper case', () => {
		const result = parseBankAccount(
			formDataOf({
				name: 'Mietkonto',
				iban: 'de02 1203 0000 0000 2020 51',
				bic: 'byladem1001',
				holder: 'Oliver Beispiel'
			})
		);
		expect(result).toEqual({
			ok: true,
			data: {
				name: 'Mietkonto',
				iban: 'DE02120300000000202051',
				bic: 'BYLADEM1001',
				holder: 'Oliver Beispiel'
			}
		});
	});

	it('rejects a wrong IBAN checksum and a malformed BIC', () => {
		const result = parseBankAccount(
			formDataOf({ name: 'Konto', iban: 'DE02120300000000202052', bic: 'abc', holder: 'X' })
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.iban).toBe('Bitte gib eine gültige IBAN an.');
		expect(result.errors.bic).toBe('Bitte gib eine gültige BIC an (8 oder 11 Zeichen).');
		expect(result.values.iban).toBe('DE02120300000000202052');
	});

	it('needs name, IBAN and holder; the BIC is optional', () => {
		const result = parseBankAccount(formDataOf({ name: '', iban: '', bic: '', holder: '' }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(Object.keys(result.errors).sort()).toEqual(['holder', 'iban', 'name']);
	});
});

describe('parseImport', () => {
	const csv = new File(['Datum;Betrag\n01.10.2026;1,00'], 'export.csv', { type: 'text/csv' });

	it('takes the uploaded file in step one', () => {
		const result = parseImport(formDataOf({ bankAccountId: 'k1', file: csv }));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toMatchObject({
			bankAccountId: 'k1',
			content: null,
			fileName: 'export.csv',
			preset: '',
			mapping: {
				bookingDate: '',
				valueDate: '',
				amount: '',
				counterpartName: '',
				counterpartIban: '',
				purpose: ''
			}
		});
		expect(result.data.file).toBe(csv);
	});

	it('takes the base64 content and the mapping in step two', () => {
		const result = parseImport(
			formDataOf({
				bankAccountId: 'k1',
				content: 'RGF0dW07QmV0cmFn',
				fileName: 'export.csv',
				preset: 'generic',
				bookingDate: 'Datum',
				amount: 'Betrag'
			})
		);
		expect(result).toEqual({
			ok: true,
			data: {
				bankAccountId: 'k1',
				file: null,
				content: 'RGF0dW07QmV0cmFn',
				fileName: 'export.csv',
				preset: 'generic',
				mapping: {
					bookingDate: 'Datum',
					valueDate: '',
					amount: 'Betrag',
					counterpartName: '',
					counterpartIban: '',
					purpose: ''
				}
			}
		});
	});

	it('needs a file or content, and a bank account', () => {
		const result = parseImport(formDataOf({}));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.bankAccountId).toBe('Bitte wähle einen Eintrag aus.');
		expect(result.errors.file).toBe('Bitte wähle eine Datei aus.');
	});

	it('names the missing date or amount column of a generic mapping', () => {
		const empty = {
			bookingDate: '',
			valueDate: '',
			amount: '',
			counterpartName: '',
			counterpartIban: '',
			purpose: ''
		};
		expect(mappingError(empty)).toBe('Bitte wähle die Spalte mit dem Buchungstag.');
		expect(mappingError({ ...empty, bookingDate: 'Datum' })).toBe(
			'Bitte wähle die Spalte mit dem Betrag.'
		);
		expect(mappingError({ ...empty, bookingDate: 'Datum', amount: 'Betrag' })).toBeUndefined();
	});

	it('turns the selects into a column mapping, empty selects into null', () => {
		expect(
			toColumnMapping({
				bookingDate: 'Datum',
				valueDate: '',
				amount: 'Betrag',
				counterpartName: 'Name',
				counterpartIban: '',
				purpose: 'Text'
			})
		).toEqual({
			bookingDate: 'Datum',
			valueDate: null,
			amount: 'Betrag',
			counterpartName: 'Name',
			counterpartIban: null,
			purpose: 'Text'
		});
	});
});

describe('parseAssignment', () => {
	it('assigns the whole amount to one lease, signed like the transaction', () => {
		expect(parseAssignment(formDataOf({ leaseId: 'l1', target: 'rent' }), 85000)).toEqual({
			ok: true,
			data: { target: 'rent', parts: [{ leaseId: 'l1', amount: 85000 }], remember: false }
		});
		expect(
			parseAssignment(formDataOf({ leaseId: 'l1', target: 'deposit', remember: 'on' }), -180000)
		).toEqual({
			ok: true,
			data: { target: 'deposit', parts: [{ leaseId: 'l1', amount: -180000 }], remember: true }
		});
	});

	it('splits over two leases when the amounts add up: 850 = 800 + 50', () => {
		const result = parseAssignment(
			formDataOf({
				leaseId: 'l1',
				target: 'rent',
				splitLeaseId: 'l2',
				amount: '800,00',
				splitAmount: '50'
			}),
			85000
		);
		expect(result).toEqual({
			ok: true,
			data: {
				target: 'rent',
				parts: [
					{ leaseId: 'l1', amount: 80000 },
					{ leaseId: 'l2', amount: 5000 }
				],
				remember: false
			}
		});
	});

	it('refuses a split whose amounts do not sum to the transaction', () => {
		const result = parseAssignment(
			formDataOf({
				leaseId: 'l1',
				target: 'rent',
				splitLeaseId: 'l2',
				amount: '800,00',
				splitAmount: '40,00'
			}),
			85000
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.splitAmount).toBe(
			`Die beiden Beträge müssen zusammen ${formatCents(85000)} ergeben.`
		);
		expect(result.values.amount).toBe('800,00');
	});

	it('refuses to split a deposit, the same lease twice, or to remember a split', () => {
		const result = parseAssignment(
			formDataOf({
				leaseId: 'l1',
				target: 'deposit',
				splitLeaseId: 'l1',
				amount: '1',
				splitAmount: '1',
				remember: 'on'
			}),
			200
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.splitLeaseId).toBe(
			'Bitte wähle einen anderen Mietvertrag für den zweiten Teil.'
		);
		expect(result.errors.remember).toBe('Eine aufgeteilte Zuordnung kann nicht gemerkt werden.');
	});

	it('needs a lease and a target', () => {
		const result = parseAssignment(formDataOf({}), 100);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.leaseId).toBe('Bitte wähle einen Eintrag aus.');
		expect(result.errors.target).toBe('Bitte wähle einen Eintrag aus.');
	});
});

describe('parseRule', () => {
	it('accepts a lease, a field and a pattern', () => {
		expect(
			parseRule(
				formDataOf({ leaseId: 'l1', field: 'purpose', pattern: ' Wohnung 2 ', confirmed: 'on' })
			)
		).toEqual({
			ok: true,
			data: { leaseId: 'l1', field: 'purpose', pattern: 'Wohnung 2', confirmed: true }
		});
		const unconfirmed = parseRule(formDataOf({ leaseId: 'l1', field: 'purpose', pattern: 'ab' }));
		expect(unconfirmed.ok && unconfirmed.data.confirmed).toBe(false);
	});

	it('rejects an unknown field and a one-character pattern', () => {
		const result = parseRule(formDataOf({ leaseId: 'l1', field: 'colour', pattern: 'x' }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.field).toBe('Bitte wähle einen gültigen Eintrag aus.');
		expect(result.errors.pattern).toBe('Mindestens zwei Zeichen.');
	});
});
