import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import { parseApplicant, parseLetting, parseSelfDisclosure } from './lettings';

describe('parseLetting', () => {
	it('reads the terms and needs a unit and a Kaltmiete', () => {
		expect(
			parseLetting(
				formDataOf({
					unitId: 'u1',
					availableFrom: '2027-02-01',
					baseRent: '815,00',
					operatingCostPrepayment: '160',
					heatingCostPrepayment: '',
					securityDeposit: '2.445,00',
					requiresWbs: 'on',
					notes: ' Balkon '
				})
			)
		).toEqual({
			ok: true,
			data: {
				unitId: 'u1',
				availableFrom: '2027-02-01',
				baseRent: 81500,
				operatingCostPrepayment: 16000,
				heatingCostPrepayment: 0,
				securityDeposit: 244500,
				requiresWbs: true,
				notes: 'Balkon'
			}
		});
		const refused = parseLetting(formDataOf({ availableFrom: 'morgen' }));
		expect(refused).toMatchObject({
			ok: false,
			errors: {
				unitId: expect.any(String),
				baseRent: expect.any(String),
				availableFrom: expect.any(String)
			}
		});
	});
});

describe('parseSelfDisclosure', () => {
	it('needs only the names', () => {
		const result = parseSelfDisclosure(formDataOf({ firstName: 'Miriam', lastName: 'Krüger' }));
		expect(result).toMatchObject({
			ok: true,
			data: {
				firstName: 'Miriam',
				lastName: 'Krüger',
				email: null,
				adults: null,
				netIncome: null,
				insolvency: null,
				hasWbs: null,
				coFirstName: null
			}
		});
	});

	it('reads every answer', () => {
		const result = parseSelfDisclosure(
			formDataOf({
				salutation: 'Frau',
				firstName: 'Miriam',
				lastName: 'Krüger',
				birthDate: '1991-04-07',
				email: 'Miriam@Example.org',
				phone: '0160 3318274',
				street: 'brandenburger str. 31',
				postalCode: '14467',
				city: 'Potsdam',
				adults: '2',
				children: '1',
				occupation: 'Ingenieurin',
				employer: 'Havelwerke',
				netIncome: '4.200',
				pets: 'eine Katze',
				insolvency: 'nein',
				hasWbs: 'ja',
				moveInDate: '2027-02-01',
				coFirstName: 'Jan',
				coLastName: 'Krüger',
				coBirthDate: '1990-01-02',
				coOccupation: 'Lehrer',
				coEmployer: 'Land Brandenburg',
				message: 'Wir freuen uns.'
			})
		);
		expect(result).toMatchObject({
			ok: true,
			data: {
				email: 'miriam@example.org',
				adults: 2,
				children: 1,
				netIncome: 420000,
				insolvency: false,
				hasWbs: true,
				coLastName: 'Krüger'
			}
		});
	});

	it('refuses what cannot be right', () => {
		const result = parseSelfDisclosure(
			formDataOf({
				firstName: '',
				lastName: 'Krüger',
				birthDate: '2090-01-01',
				coBirthDate: '2090-01-01',
				email: 'kaputt',
				postalCode: '123',
				adults: '0',
				children: '1,5',
				netIncome: 'viel',
				insolvency: 'vielleicht',
				coFirstName: 'Jan'
			})
		);
		expect(result).toMatchObject({
			ok: false,
			errors: {
				firstName: expect.any(String),
				birthDate: 'Das Datum liegt in der Zukunft.',
				coBirthDate: 'Das Datum liegt in der Zukunft.',
				email: expect.any(String),
				postalCode: 'Die Postleitzahl hat fünf Ziffern.',
				adults: expect.any(String),
				children: expect.any(String),
				netIncome: expect.any(String),
				insolvency: 'Bitte wähle ja oder nein.',
				coLastName: 'Bitte gib Vor- und Nachnamen der weiteren Person an.'
			}
		});
		expect(
			parseSelfDisclosure(formDataOf({ firstName: 'A', lastName: 'B', coLastName: 'C' }))
		).toMatchObject({ ok: false, errors: { coFirstName: expect.any(String) } });
	});
});

describe('parseApplicant', () => {
	it('adds the viewing, the note and the stars', () => {
		expect(
			parseApplicant(
				formDataOf({
					firstName: 'Miriam',
					lastName: 'Krüger',
					viewingAt: '2026-11-18T17:30',
					notes: 'Über Inserat',
					rating: '4'
				})
			)
		).toMatchObject({
			ok: true,
			data: { viewingAt: '2026-11-18T17:30', notes: 'Über Inserat', rating: 4 }
		});
		expect(
			parseApplicant(
				formDataOf({ firstName: 'A', lastName: 'B', viewingAt: '2026-11-18', rating: '6' })
			)
		).toMatchObject({
			ok: false,
			errors: { viewingAt: expect.any(String), rating: expect.any(String) }
		});
		expect(
			parseApplicant(formDataOf({ firstName: 'A', lastName: 'B', viewingAt: '2026-13-45T10:00' }))
		).toMatchObject({ ok: false, errors: { viewingAt: expect.any(String) } });
	});
});
