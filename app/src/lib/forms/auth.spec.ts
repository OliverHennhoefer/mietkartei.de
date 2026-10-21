import { describe, expect, it } from 'vitest';
import { parseLandlord } from './auth';
import { formDataOf } from './fields';

describe('parseLandlord', () => {
	it('turns empty fields into null', () => {
		expect(parseLandlord(formDataOf({}))).toEqual({
			ok: true,
			data: { landlordName: null, street: null, postalCode: null, city: null }
		});
		expect(
			parseLandlord(
				formDataOf({
					landlordName: 'Erika Vermieter',
					street: 'Hauptstraße 1',
					postalCode: '10115',
					city: 'Berlin'
				})
			)
		).toEqual({
			ok: true,
			data: {
				landlordName: 'Erika Vermieter',
				street: 'Hauptstraße 1',
				postalCode: '10115',
				city: 'Berlin'
			}
		});
	});

	it('rejects a postal code without five digits', () => {
		expect(parseLandlord(formDataOf({ postalCode: '1011', city: 'Berlin' }))).toMatchObject({
			ok: false,
			errors: { postalCode: 'Die Postleitzahl hat fünf Ziffern.' },
			values: { postalCode: '1011', city: 'Berlin' }
		});
	});
});
