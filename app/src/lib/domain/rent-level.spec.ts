import { describe, expect, it } from 'vitest';
import { deviation, rentLevel, type RentedUnit } from './rent-level.ts';

const lease = (
	baseRent: number,
	floorArea: number | null,
	kind: RentedUnit['kind'] = 'residential'
): RentedUnit => ({ kind, unit: { floorArea }, currentRent: { baseRent } });

describe('rentLevel', () => {
	it('averages the Kaltmiete of flats over their floor area', () => {
		expect(rentLevel([lease(600_00, 60), lease(900_00, 80)])).toEqual({
			perSquareMetre: 10_71,
			area: 140,
			count: 2
		});
	});

	it('leaves out other units and flats without a floor area', () => {
		expect(
			rentLevel([
				lease(500_00, 50),
				lease(2000_00, 100, 'commercial'),
				lease(50_00, 12, 'parking'),
				lease(700_00, null)
			])
		).toEqual({ perSquareMetre: 10_00, area: 50, count: 1 });
		expect(rentLevel([lease(700_00, null), lease(800_00, 0)])).toBeNull();
		expect(rentLevel([])).toBeNull();
	});
});

describe('deviation', () => {
	it('gives the difference to the average in percent', () => {
		expect(deviation(10_00, 8_00)).toBe(25);
		expect(deviation(7_00, 7_50)).toBe(-6.7);
		expect(deviation(7_50, 7_50)).toBe(0);
	});
});
