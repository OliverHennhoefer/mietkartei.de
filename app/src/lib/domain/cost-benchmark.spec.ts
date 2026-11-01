import { describe, expect, it } from 'vitest';
import {
	benchmarkGroups,
	benchmarkOutliers,
	costBenchmark,
	type BenchmarkInput
} from './cost-benchmark';

// Haus: 100 m² over two flats and a parking space. Hof: one of its two flats has no area. 2025.

function input(overrides: Partial<BenchmarkInput> = {}): BenchmarkInput {
	return {
		properties: [
			{ id: 'haus', name: 'Haus' },
			{ id: 'hof', name: 'Hof' }
		],
		units: [
			{ propertyId: 'haus', kind: 'apartment', floorArea: 60 },
			{ propertyId: 'haus', kind: 'apartment', floorArea: 40 },
			{ propertyId: 'haus', kind: 'parking', floorArea: null },
			{ propertyId: 'hof', kind: 'apartment', floorArea: 50 },
			{ propertyId: 'hof', kind: 'apartment', floorArea: null }
		],
		costItems: [
			// 1.200 € Grundsteuer for 2025: 1 € per m² and month.
			{
				propertyId: 'haus',
				betrkvItem: 1,
				amount: 1200_00,
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31'
			},
			// Heating from July 2024 to June 2025: half of it falls into 2025.
			{
				propertyId: 'haus',
				betrkvItem: 4,
				amount: 2400_00,
				periodStart: '2024-07-01',
				periodEnd: '2025-06-30'
			},
			{
				propertyId: 'hof',
				betrkvItem: 1,
				amount: 300_00,
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31'
			}
		],
		...overrides
	};
}

describe('costBenchmark', () => {
	it('gives the costs of the year per m² and month by group', () => {
		const result = costBenchmark(input(), { year: 2025, propertyId: null });
		const row = (key: string) => result.rows.find((group) => group.key === key)!;
		expect(row('propertyTax')).toMatchObject({ amount: 1200_00, perSqm: 100, reference: 18 });
		// 181 of its 365 days.
		expect(row('heating').amount).toBe(Math.round((2400_00 * 181) / 365));
		expect(row('elevator')).toMatchObject({ amount: 0, perSqm: 0 });
		expect(result.rows).toHaveLength(benchmarkGroups.length);
		expect(result.area).toBe(100);
	});

	it('leaves a property with a flat of unknown area out of the figures per m² and names it', () => {
		const result = costBenchmark(input(), { year: 2025, propertyId: null });
		expect(result.withoutArea).toEqual(['Hof']);
		expect(result.properties.find((row) => row.id === 'hof')).toMatchObject({
			amount: 300_00,
			perSqm: null
		});
		expect(result.rows.find((group) => group.key === 'propertyTax')!.amount).toBe(1200_00);
	});

	it('shows one property and nothing for a year without costs', () => {
		expect(costBenchmark(input(), { year: 2025, propertyId: 'hof' })).toMatchObject({
			area: 0,
			perSqm: null,
			properties: [{ id: 'hof' }]
		});
		expect(costBenchmark(input(), { year: 2023, propertyId: null })).toMatchObject({
			amount: 0,
			perSqm: null,
			properties: []
		});
	});
});

describe('benchmarkOutliers', () => {
	// 100 m² over a year: 1 € a year is 1/12 cent per m² and month.
	const year = 365;
	it('flags a group at twice the Mieterbund value and 0,10 € more', () => {
		// Hauswart 0,21 €: 0,42 € (504 €) is flagged, 0,41 € (492 €) not.
		expect(benchmarkOutliers(new Map([[14, 50400]]), 100, year)).toEqual([
			{ group: expect.objectContaining({ key: 'caretaker' }), perSqm: 42 }
		]);
		expect(benchmarkOutliers(new Map([[14, 49200]]), 100, year)).toEqual([]);
		// Schornstein 0,04 €: twice is not enough below 0,14 €.
		expect(benchmarkOutliers(new Map([[12, 12000]]), 100, year)).toEqual([]);
		expect(benchmarkOutliers(new Map([[12, 16800]]), 100, year)).toHaveLength(1);
		// The Grundsteuer is the town's, never flagged.
		expect(benchmarkOutliers(new Map([[1, 100000]]), 100, year)).toEqual([]);
	});

	it('adds up the items of a group, scales the period and needs an area', () => {
		// Wasser and Abwasser 0,29 € together: 0,30 + 0,30 € in half a year.
		const water = new Map([
			[2, 18000],
			[3, 18000]
		]);
		expect(benchmarkOutliers(water, 100, 182.5)).toEqual([
			{ group: expect.objectContaining({ key: 'water' }), perSqm: 60 }
		]);
		expect(benchmarkOutliers(water, 0, 182.5)).toEqual([]);
	});
});
