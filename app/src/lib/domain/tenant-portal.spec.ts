import { describe, expect, it } from 'vitest';
import { qrPath } from './qr';
import {
	damageNote,
	portalOpenOn,
	portalOpenUntil,
	portalPath,
	portalPrivacyNotice
} from './tenant-portal';

describe('tenant portal rules', () => {
	it('keeps the link open a year after the lease ends', () => {
		expect(portalOpenUntil(null)).toBeNull();
		expect(portalOpenUntil('2026-03-31')).toBe('2027-03-31');
		expect(portalOpenOn(null, '2099-01-01')).toBe(true);
		expect(portalOpenOn('2026-03-31', '2027-03-31')).toBe(true);
		expect(portalOpenOn('2026-03-31', '2027-04-01')).toBe(false);
		expect(portalPath('abc')).toBe('/mieterportal/abc');
	});

	it('names the landlord as controller, or the landlord in general', () => {
		const landlord = {
			name: 'Erika Muster',
			street: 'Lindenstraße 4',
			postalCode: '10969',
			city: 'Berlin'
		};
		expect(portalPrivacyNotice(landlord)[0]).toBe(
			'Verantwortlich für diese Seite und Ihre Angaben ist Erika Muster, Lindenstraße 4, 10969 Berlin.'
		);
		expect(
			portalPrivacyNotice({ name: '', street: null, postalCode: null, city: null })[0]
		).toContain('ist Ihr Vermieter.');
	});

	it('writes who reported a damage into the task', () => {
		expect(
			damageNote({
				description: 'Tür klemmt',
				reporter: 'Lena',
				phone: null,
				reportedOn: '27.11.2026'
			})
		).toBe('Tür klemmt\n\nGemeldet über das Mieterportal von Lena am 27.11.2026.');
	});

	it('draws a QR code as one path of square modules', () => {
		const { size, path } = qrPath('https://app.mietkartei.de/mieterportal/abc');
		expect(size).toBeGreaterThanOrEqual(21);
		expect(path).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
	});
});
