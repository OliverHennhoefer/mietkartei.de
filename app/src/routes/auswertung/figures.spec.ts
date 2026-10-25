import { describe, expect, it } from 'vitest';
import { percent, perSqm } from './figures';

describe('figures', () => {
	it('writes shares and rents per m² the German way, a dash without a value', () => {
		expect(percent(0.845)).toBe('84,5 %');
		expect(percent(null)).toBe('–');
		expect(perSqm(10.5)).toBe('10,50 €/m²');
		expect(perSqm(null)).toBe('–');
	});
});
