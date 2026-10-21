import { describe, expect, it } from 'vitest';
import { formatArea, formatNumber, personName, pluralize } from './format';

describe('format', () => {
	it('writes numbers and areas the German way', () => {
		expect(formatNumber(2.5)).toBe('2,5');
		expect(formatNumber(1234.567)).toBe('1.234,57');
		expect(formatNumber(61.04, 1)).toBe('61');
		expect(formatNumber(27.236, 1)).toBe('27,2');
		expect(formatArea(72.5)).toBe('72,5 m²');
	});

	it('picks singular or plural', () => {
		expect(pluralize(1, 'Einheit', 'Einheiten')).toBe('1 Einheit');
		expect(pluralize(0, 'Einheit', 'Einheiten')).toBe('0 Einheiten');
		expect(pluralize(3, 'Einheit', 'Einheiten')).toBe('3 Einheiten');
	});

	it('joins first and last name', () => {
		expect(personName({ firstName: 'Erika', lastName: 'Mustermann' })).toBe('Erika Mustermann');
		expect(personName({ firstName: '', lastName: 'Mustermann' })).toBe('Mustermann');
	});
});
