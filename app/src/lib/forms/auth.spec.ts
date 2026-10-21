import { describe, expect, it } from 'vitest';
import { parseLandlord } from './auth';
import { formDataOf } from './fields';

describe('parseLandlord', () => {
	it('turns empty fields into null and normalizes the IBAN', () => {
		expect(parseLandlord(formDataOf({}))).toEqual({
			ok: true,
			data: {
				landlordName: null,
				street: null,
				postalCode: null,
				city: null,
				iban: null,
				bankName: null
			}
		});
		expect(
			parseLandlord(
				formDataOf({
					landlordName: 'Erika Vermieter',
					street: 'Hauptstraße 1',
					postalCode: '10115',
					city: 'Berlin',
					iban: 'de89 3704 0044 0532 0130 00',
					bankName: 'Musterbank'
				})
			)
		).toEqual({
			ok: true,
			data: {
				landlordName: 'Erika Vermieter',
				street: 'Hauptstraße 1',
				postalCode: '10115',
				city: 'Berlin',
				iban: 'DE89370400440532013000',
				bankName: 'Musterbank'
			}
		});
	});

	it('rejects a postal code without five digits and an IBAN with a wrong checksum', () => {
		expect(
			parseLandlord(
				formDataOf({ postalCode: '1011', city: 'Berlin', iban: 'DE89370400440532013001' })
			)
		).toMatchObject({
			ok: false,
			errors: {
				postalCode: 'Die Postleitzahl hat fünf Ziffern.',
				iban: 'Bitte gib eine gültige IBAN an.'
			},
			values: { postalCode: '1011', city: 'Berlin' }
		});
	});
});
