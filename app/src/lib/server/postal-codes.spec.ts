import { describe, expect, it } from 'vitest';
import { postalCodeData } from './postal-codes-data.ts';
import { locatePostalCode } from './postal-codes.ts';

describe('locatePostalCode', () => {
	it('finds postal codes across the table', () => {
		const berlin = locatePostalCode('10115');
		expect(berlin?.lat).toBeCloseTo(52.53, 1);
		expect(berlin?.lon).toBeCloseTo(13.38, 1);
		const munich = locatePostalCode(' 80331 ');
		expect(munich?.lat).toBeCloseTo(48.14, 1);
		expect(munich?.lon).toBeCloseTo(11.57, 1);
		expect(locatePostalCode('01067')?.lat).toBeCloseTo(51.06, 1);
		expect(locatePostalCode('99998')).not.toBeNull();
	});

	it('has no position for unknown or malformed codes', () => {
		expect(locatePostalCode('00000')).toBeNull();
		expect(locatePostalCode('1234')).toBeNull();
		expect(locatePostalCode('abcde')).toBeNull();
		expect(locatePostalCode('')).toBeNull();
	});

	it('keeps every entry inside Germany', () => {
		for (let start = 0; start < postalCodeData.length; start += 13) {
			const lat = Number(postalCodeData.slice(start + 5, start + 9)) / 100;
			const lon = Number(postalCodeData.slice(start + 9, start + 13)) / 100;
			expect(lat).toBeGreaterThan(47.2);
			expect(lat).toBeLessThan(55.1);
			expect(lon).toBeGreaterThan(5.8);
			expect(lon).toBeLessThan(15.1);
		}
	});
});
