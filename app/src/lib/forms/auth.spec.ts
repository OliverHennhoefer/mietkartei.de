import { describe, expect, it } from 'vitest';
import {
	parseAcceptInvitation,
	parseDeleteAccount,
	parseEmailForm,
	parseInvitation,
	parseLandlord,
	parseNewPassword,
	parsePasswordChange,
	parseProfile
} from './auth';
import { formDataOf } from './fields';

const good = 'ein-sicheres-passwort';

describe('parseEmailForm', () => {
	it('lower-cases the address and rejects an invalid one', () => {
		expect(parseEmailForm(formDataOf({ email: ' Erika@Example.org ' }))).toEqual({
			ok: true,
			data: { email: 'erika@example.org' }
		});
		const bad = parseEmailForm(formDataOf({ email: 'erika@' }));
		expect(bad).toMatchObject({
			ok: false,
			errors: { email: 'Bitte gib eine gültige E-Mail-Adresse an.' },
			values: { email: 'erika@' }
		});
	});
});

describe('parseNewPassword', () => {
	it('accepts a repeated password of at least ten characters', () => {
		expect(parseNewPassword(formDataOf({ password: good, passwordConfirm: good }))).toEqual({
			ok: true,
			data: { password: good, passwordConfirm: good }
		});
	});

	it('rejects a short password, a long one and a repetition that differs, never echoing them', () => {
		const short = parseNewPassword(formDataOf({ password: 'kurz', passwordConfirm: 'kurz' }));
		expect(short).toEqual({
			ok: false,
			errors: { password: 'Das Passwort braucht mindestens 10 Zeichen.' },
			values: {}
		});
		const long = parseNewPassword(
			formDataOf({ password: 'x'.repeat(201), passwordConfirm: 'x'.repeat(201) })
		);
		expect(long).toMatchObject({ ok: false, errors: { password: 'Das Passwort ist zu lang.' } });
		const differ = parseNewPassword(formDataOf({ password: good, passwordConfirm: `${good}!` }));
		expect(differ).toEqual({
			ok: false,
			errors: { passwordConfirm: 'Die Passwörter stimmen nicht überein.' },
			values: {}
		});
	});
});

describe('parsePasswordChange', () => {
	it('needs the current password as well', () => {
		expect(
			parsePasswordChange(
				formDataOf({ currentPassword: 'alt', password: good, passwordConfirm: good })
			)
		).toEqual({
			ok: true,
			data: { currentPassword: 'alt', password: good, passwordConfirm: good }
		});
		expect(parsePasswordChange(formDataOf({ password: good, passwordConfirm: good }))).toEqual({
			ok: false,
			errors: { currentPassword: 'Bitte gib dein aktuelles Passwort an.' },
			values: {}
		});
	});
});

describe('parseInvitation', () => {
	it('defaults the role to manager and accepts owner', () => {
		expect(parseInvitation(formDataOf({ email: 'Neu@Example.org' }))).toEqual({
			ok: true,
			data: { email: 'neu@example.org', role: 'manager' }
		});
		expect(parseInvitation(formDataOf({ email: 'neu@example.org', role: 'owner' }))).toEqual({
			ok: true,
			data: { email: 'neu@example.org', role: 'owner' }
		});
	});

	it('rejects an unknown role and a bad address', () => {
		expect(parseInvitation(formDataOf({ email: 'neu', role: 'admin' }))).toMatchObject({
			ok: false,
			errors: {
				email: 'Bitte gib eine gültige E-Mail-Adresse an.',
				role: 'Bitte wähle einen gültigen Eintrag aus.'
			}
		});
	});
});

describe('parseAcceptInvitation', () => {
	it('needs a name and the password twice', () => {
		expect(
			parseAcceptInvitation(formDataOf({ name: ' Neu ', password: good, passwordConfirm: good }))
		).toEqual({ ok: true, data: { name: 'Neu', password: good, passwordConfirm: good } });
		expect(parseAcceptInvitation(formDataOf({ password: good, passwordConfirm: '' }))).toEqual({
			ok: false,
			errors: {
				name: 'Bitte fülle dieses Feld aus.',
				passwordConfirm: 'Die Passwörter stimmen nicht überein.'
			},
			values: { name: '' }
		});
	});
});

describe('parseProfile', () => {
	it('lets the name change without a password', () => {
		expect(
			parseProfile(formDataOf({ name: 'Erika', email: 'a@example.org' }), 'a@example.org')
		).toEqual({ ok: true, data: { name: 'Erika', email: 'a@example.org', currentPassword: '' } });
		expect(parseProfile(formDataOf({ name: '', email: 'a@example.org' }), 'a@example.org')).toEqual(
			{ ok: true, data: { name: null, email: 'a@example.org', currentPassword: '' } }
		);
	});

	it('needs the password for a new address and passes it on', () => {
		const missing = parseProfile(
			formDataOf({ name: 'Erika', email: 'neu@example.org' }),
			'a@example.org'
		);
		expect(missing).toEqual({
			ok: false,
			errors: { currentPassword: 'Zum Ändern der E-Mail-Adresse brauchen wir dein Passwort.' },
			values: { name: 'Erika', email: 'neu@example.org' }
		});
		expect(
			parseProfile(
				formDataOf({ name: 'Erika', email: 'Neu@example.org', currentPassword: 'geheim' }),
				'a@example.org'
			)
		).toEqual({
			ok: true,
			data: { name: 'Erika', email: 'neu@example.org', currentPassword: 'geheim' }
		});
	});
});

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
			parseLandlord(formDataOf({ postalCode: '1011', iban: 'DE89370400440532013001' }))
		).toMatchObject({
			ok: false,
			errors: {
				postalCode: 'Die Postleitzahl hat fünf Ziffern.',
				iban: 'Bitte gib eine gültige IBAN an.'
			}
		});
	});
});

describe('parseDeleteAccount', () => {
	it('needs the password and never echoes it', () => {
		expect(parseDeleteAccount(formDataOf({ password: 'geheim' }))).toEqual({
			ok: true,
			data: { password: 'geheim' }
		});
		expect(parseDeleteAccount(formDataOf({}))).toEqual({
			ok: false,
			errors: { password: 'Bitte gib dein Passwort an.' },
			values: {}
		});
	});
});
