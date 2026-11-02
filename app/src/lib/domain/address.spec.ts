import { describe, expect, it } from 'vitest';
import {
	normalizeFloor,
	normalizePostalCode,
	normalizeStreet,
	singleLine,
	streetKey
} from './address';

describe('normalizeStreet', () => {
	it('keeps house number suffixes and ranges as typed', () => {
		expect(normalizeStreet('Haberacker 1e')).toBe('Haberacker 1e');
		expect(normalizeStreet('Haberacker 1 E')).toBe('Haberacker 1 E');
		expect(normalizeStreet('Am Markt 4-6')).toBe('Am Markt 4-6');
		expect(normalizeStreet('Karl-Liebknecht-Str. 18a')).toBe('Karl-Liebknecht-Str. 18a');
	});

	it('tidies spaces, tabs, line breaks and commas', () => {
		expect(normalizeStreet('  Haberacker   1e ')).toBe('Haberacker 1e');
		expect(normalizeStreet('Haberacker\t1e')).toBe('Haberacker 1e');
		expect(normalizeStreet('Haberacker 1e')).toBe('Haberacker 1e');
		expect(normalizeStreet('Hinterhaus ,Haberacker 1e')).toBe('Hinterhaus, Haberacker 1e');
		expect(normalizeStreet('Haberacker 1e,')).toBe('Haberacker 1e');
		expect(normalizeStreet('Haberacker,1e')).toBe('Haberacker, 1e');
	});
});

describe('streetKey', () => {
	it('matches spellings of the same street', () => {
		const key = streetKey('Haberacker 1e');
		expect(streetKey('haberacker  1E')).toBe(key);
		expect(streetKey('Haberacker 1 e')).toBe(key);
		expect(streetKey('Haberacker, 1e')).toBe(key);
		expect(streetKey('Lindenstr. 4')).toBe(streetKey('Lindenstraße 4'));
		expect(streetKey('Lindenstr 4')).toBe(streetKey('Lindenstrasse 4'));
		expect(streetKey('Lindenstr.4')).toBe(streetKey('Lindenstraße 4'));
		expect(streetKey('Karl-Liebknecht-Str. 18')).toBe(streetKey('Karl Liebknecht Straße 18'));
	});

	it('tells different house numbers apart', () => {
		expect(streetKey('Haberacker 1e')).not.toBe(streetKey('Haberacker 1'));
		expect(streetKey('Am Markt 4-6')).not.toBe(streetKey('Am Markt 46'));
		expect(streetKey('Lindenstraße 4')).not.toBe(streetKey('Lindenstraße 14'));
	});
});

describe('normalizePostalCode and singleLine', () => {
	it('drops spaces in the postal code and tidies a city', () => {
		expect(normalizePostalCode(' 10 115 ')).toBe('10115');
		expect(singleLine('  Frankfurt  am\tMain ')).toBe('Frankfurt am Main');
	});
});

describe('normalizeFloor', () => {
	it('writes upper floors as „4. OG“', () => {
		for (const typed of [
			'4. OG',
			'4. og',
			'4.OG',
			'4 og',
			'4OG',
			'4. Obergeschoss',
			'4. Stock',
			'4. Etage',
			'4 o.g.',
			'viertes OG',
			'Viertes Obergeschoss',
			'vierter Stock',
			'vierte Etage'
		]) {
			expect(normalizeFloor(typed), typed).toBe('4. OG');
		}
		expect(normalizeFloor('erstes og')).toBe('1. OG');
		expect(normalizeFloor('fünfte Etage')).toBe('5. OG');
		expect(normalizeFloor('12. OG')).toBe('12. OG');
	});

	it('names ground, top and lower floors by their short names', () => {
		expect(normalizeFloor('eg')).toBe('EG');
		expect(normalizeFloor('Erdgeschoss')).toBe('EG');
		expect(normalizeFloor('Parterre')).toBe('EG');
		expect(normalizeFloor('0. OG')).toBe('EG');
		expect(normalizeFloor('dg')).toBe('DG');
		expect(normalizeFloor('Dachgeschoß')).toBe('DG');
		expect(normalizeFloor('UG')).toBe('UG');
		expect(normalizeFloor('kg')).toBe('KG');
	});

	it('keeps what follows the floor', () => {
		expect(normalizeFloor('3.og links')).toBe('3. OG links');
		expect(normalizeFloor('3. OG, Hinterhaus')).toBe('3. OG, Hinterhaus');
		expect(normalizeFloor('eg  rechts')).toBe('EG rechts');
		expect(normalizeFloor('Erdgeschoss, Seitenflügel')).toBe('EG, Seitenflügel');
	});

	it('keeps anything else as typed', () => {
		expect(normalizeFloor('Hochparterre')).toBe('Hochparterre');
		expect(normalizeFloor('Souterrain')).toBe('Souterrain');
		expect(normalizeFloor('4')).toBe('4');
		expect(normalizeFloor('Maisonette 2./3. OG')).toBe('Maisonette 2./3. OG');
		expect(normalizeFloor('Egelsbach')).toBe('Egelsbach');
		expect(normalizeFloor('  Galerie   ')).toBe('Galerie');
	});
});
