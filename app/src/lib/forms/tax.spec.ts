import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import { parseDepreciation, parseLoanInterest } from './tax';

describe('parseDepreciation', () => {
	it('reads the four figures with German decimals', () => {
		const result = parseDepreciation(
			formDataOf({
				acquisitionDate: '2020-04-15',
				acquisitionCost: '412.500,00',
				buildingShare: '72,5',
				depreciationRate: '2'
			})
		);
		expect(result).toEqual({
			ok: true,
			data: {
				acquisitionDate: '2020-04-15',
				acquisitionCost: 412_500_00,
				buildingShare: 72.5,
				depreciationRate: 2
			}
		});
	});

	it('takes four empty fields as no AfA, but refuses some of them', () => {
		expect(parseDepreciation(formDataOf({}))).toMatchObject({
			ok: true,
			data: { acquisitionDate: null, acquisitionCost: null }
		});
		const partial = parseDepreciation(
			formDataOf({ acquisitionCost: '100.000,00', buildingShare: '120' })
		);
		expect(partial.ok).toBe(false);
		if (partial.ok) return;
		expect(Object.keys(partial.errors).sort()).toEqual([
			'acquisitionDate',
			'buildingShare',
			'depreciationRate'
		]);
	});
});

describe('parseLoanInterest', () => {
	it('reads the year and an optional amount', () => {
		expect(parseLoanInterest(formDataOf({ year: '2025', loanInterest: '1.234,56' }))).toEqual({
			ok: true,
			data: { year: 2025, loanInterest: 1_234_56 }
		});
		expect(parseLoanInterest(formDataOf({ year: '2025', loanInterest: '' }))).toMatchObject({
			data: { loanInterest: null }
		});
		expect(parseLoanInterest(formDataOf({ year: 'x' })).ok).toBe(false);
	});
});
