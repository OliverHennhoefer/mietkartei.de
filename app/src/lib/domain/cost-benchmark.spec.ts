import { describe, expect, it } from 'vitest';
import { benchmarkGroups, costBenchmark, type BenchmarkInput } from './cost-benchmark';

// Haus: 100 m² over two units. Hof: no floor area. 2025.

function input(overrides: Partial<BenchmarkInput> = {}): BenchmarkInput {
	return {
		properties: [
			{ id: 'haus', name: 'Haus' },
			{ id: 'hof', name: 'Hof' }
		],
		units: [
			{ propertyId: 'haus', floorArea: 60 },
			{ propertyId: 'haus', floorArea: 40 },
			{ propertyId: 'hof', floorArea: null }
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

	it('leaves a property without floor area out of the figures per m² and names it', () => {
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
