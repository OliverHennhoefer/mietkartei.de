import { describe, expect, it } from 'vitest';
import { matchMunicipality, normalizeName, parseMunicipalities } from './municipalities.ts';

// Test rows in the format of the bundled table; the rents and rates are made up.
const rows = parseMunicipalities(
	[
		'11000000;Berlin, Stadt;5252;1340;850;810',
		'06412000;Frankfurt am Main, Stadt;5011;868;1050;500',
		'12053000;Frankfurt (Oder), Stadt;5234;1450;610;',
		'15002000;Halle (Saale), Stadt;5148;1197;;500',
		'06433012;Mörfelden-Walldorf, Stadt;4999;856;980;690',
		'99000000;Nirgendwo;5000;1000;1;1',
		''
	].join('\n')
);

const at = (lat: number, lon: number) => ({ lat, lon });

describe('parseMunicipalities', () => {
	it('reads the rows with their Land and leaves out empty values and unknown Länder', () => {
		expect(rows).toHaveLength(5);
		expect(rows[0]).toEqual({
			key: '11000000',
			name: 'Berlin, Stadt',
			state: 'BE',
			lat: 52.52,
			lon: 13.4,
			rentPerSquareMetre: 850,
			propertyTaxRate: 810
		});
		expect(rows[2].propertyTaxRate).toBeNull();
		expect(rows[3].rentPerSquareMetre).toBeNull();
	});
});

describe('normalizeName', () => {
	it('drops the official suffix, brackets, case and umlauts', () => {
		expect(normalizeName('Berlin, Stadt')).toBe('berlin');
		expect(normalizeName('Halle (Saale), Stadt')).toBe('halle');
		expect(normalizeName(' Mörfelden-Walldorf ')).toBe('moerfelden walldorf');
		expect(normalizeName('Gießen')).toBe('giessen');
	});
});

describe('matchMunicipality', () => {
	it('finds the Gemeinde by its name near the postal code', () => {
		expect(matchMunicipality(rows, at(52.53, 13.38), 'Berlin')).toMatchObject({
			key: '11000000',
			byName: true
		});
		expect(matchMunicipality(rows, at(51.48, 11.97), 'Halle (Saale)')?.key).toBe('15002000');
		expect(matchMunicipality(rows, at(49.99, 8.56), 'Mörfelden-Walldorf')?.key).toBe('06433012');
	});

	it('tells two places of the same name apart by distance', () => {
		expect(matchMunicipality(rows, at(50.1, 8.7), 'Frankfurt')?.key).toBe('06412000');
		expect(matchMunicipality(rows, at(52.33, 14.5), 'Frankfurt')?.key).toBe('12053000');
		expect(matchMunicipality(rows, at(52.33, 14.5), 'Frankfurt (Oder)')?.key).toBe('12053000');
	});

	it('takes the leading word of an Ortsteil or a shortened name', () => {
		expect(matchMunicipality(rows, at(52.54, 13.2), 'Berlin-Spandau')?.key).toBe('11000000');
		expect(matchMunicipality(rows, at(50.1, 8.62), 'Frankfurt-Höchst')?.key).toBe('06412000');
	});

	it('falls back to a seat right at the postal code, but not to one farther away', () => {
		expect(matchMunicipality(rows, at(52.52, 13.41), 'Mitte')).toMatchObject({
			key: '11000000',
			byName: false
		});
		expect(matchMunicipality(rows, at(52.4, 13.1), 'Potsdam')).toBeNull();
	});

	it('keeps to the Land when one is known', () => {
		expect(matchMunicipality(rows, at(52.52, 13.41), 'Berlin', 'BB')).toBeNull();
		expect(matchMunicipality(rows, at(52.52, 13.41), 'Berlin', 'BE')?.key).toBe('11000000');
	});
});
