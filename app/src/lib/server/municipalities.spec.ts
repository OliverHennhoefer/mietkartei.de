import { describe, expect, it } from 'vitest';
import { municipalityData } from './municipalities-data.ts';
import {
	findMunicipality,
	matchMunicipality,
	normalizeName,
	parseMunicipalities
} from './municipalities.ts';

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

	it('falls back to a Gemeinde right at the postal code, but not to one farther away', () => {
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

describe('findMunicipality', () => {
	const find = (postalCode: string, city: string) =>
		findMunicipality({ postalCode, city, state: null });

	it('finds Gemeinden of the bundled table', () => {
		expect(find('10115', 'Berlin')).toMatchObject({ key: '11000000', byName: true });
		expect(find('80331', 'München')?.key).toBe('09162000');
		expect(find('60311', 'Frankfurt')?.key).toBe('06412000');
		expect(find('15230', 'Frankfurt (Oder)')?.key).toBe('12053000');
		expect(find('06108', 'Halle')?.key).toBe('15002000');
		expect(find('25715', 'Averlak')?.key).toBe('01051003');
	});

	it('carries the Zensus rent and the Hebesatz', () => {
		const berlin = find('10115', 'Berlin');
		expect(berlin?.rentPerSquareMetre).toBeGreaterThan(500);
		expect(berlin?.propertyTaxRate).toBeGreaterThan(100);
	});

	it('has no Gemeinde for an unknown postal code', () => {
		expect(find('00000', 'Berlin')).toBeNull();
	});
});

describe('the bundled table', () => {
	const all = parseMunicipalities(municipalityData);

	it('holds every Gemeinde once, inside Germany', () => {
		expect(all.length).toBeGreaterThan(10_000);
		expect(new Set(all.map((row) => row.key)).size).toBe(all.length);
		for (const row of all) {
			expect(row.key).toMatch(/^\d{8}$/);
			expect(row.lat).toBeGreaterThan(47.2);
			expect(row.lat).toBeLessThan(55.1);
			expect(row.lon).toBeGreaterThan(5.8);
			expect(row.lon).toBeLessThan(15.1);
		}
	});

	it('has plausible rents and rates', () => {
		for (const row of all) {
			if (row.rentPerSquareMetre !== null) {
				expect(row.rentPerSquareMetre).toBeGreaterThan(100);
				expect(row.rentPerSquareMetre).toBeLessThan(3000);
			}
			if (row.propertyTaxRate !== null) {
				expect(row.propertyTaxRate).toBeGreaterThan(0);
				expect(row.propertyTaxRate).toBeLessThan(2000);
			}
		}
	});
});
