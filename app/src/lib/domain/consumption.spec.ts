import { describe, expect, it } from 'vitest';
import {
	hasReadingNear,
	meterConsumption,
	readingNear,
	unitConsumption,
	valueAt,
	type Meter,
	type Reading
} from './consumption';

const reading = (readAt: string, value: number, estimated = false): Reading => ({
	readAt,
	value,
	estimated
});

const meter = (overrides: Partial<Meter> = {}): Meter => ({
	id: 'm1',
	unitId: 'u1',
	kind: 'heat',
	unit: 'kWh',
	installedAt: null,
	removedAt: null,
	readings: [reading('2024-12-31', 1000), reading('2025-06-30', 1600), reading('2025-12-31', 2000)],
	...overrides
});

describe('readingNear', () => {
	it('uses a reading within three days of the date, the nearest first', () => {
		const readings = [reading('2025-06-28', 10), reading('2025-07-02', 20)];
		expect(readingNear(readings, '2025-06-30')?.value).toBe(10);
		expect(readingNear(readings, '2025-07-01')?.value).toBe(20);
		expect(readingNear(readings, '2025-07-05')?.value).toBe(20);
		expect(readingNear(readings, '2025-07-06')).toBeUndefined();
	});

	it('prefers the earlier reading on a tie', () => {
		const readings = [reading('2025-06-29', 10), reading('2025-07-01', 20)];
		expect(readingNear(readings, '2025-06-30')?.value).toBe(10);
	});
});

describe('valueAt', () => {
	const readings = [reading('2025-01-01', 100), reading('2025-12-31', 464)];

	it('interpolates linearly between the readings around the date', () => {
		// 364 units over 364 days: one per day; 2025-07-01 is day 181.
		expect(valueAt(readings, '2025-07-01')).toEqual({
			value: 281,
			estimated: false,
			exact: false
		});
	});

	it('returns the exact reading near the date', () => {
		expect(valueAt(readings, '2025-01-03')).toEqual({
			value: 100,
			estimated: false,
			exact: true,
			readAt: '2025-01-01'
		});
	});

	it('is undefined outside the readings', () => {
		expect(valueAt(readings, '2024-12-01')).toBeUndefined();
		expect(valueAt(readings, '2026-02-01')).toBeUndefined();
		expect(valueAt([], '2025-01-01')).toBeUndefined();
	});

	it('marks an interpolation from an estimated reading', () => {
		const estimated = [reading('2025-01-01', 0), reading('2025-12-31', 365, true)];
		expect(valueAt(estimated, '2025-07-01')?.estimated).toBe(true);
	});
});

describe('meterConsumption', () => {
	it('reads the difference between the values on the two dates, with the three-day rule', () => {
		// The reading of 31 December 2024 stands in for 1 January: 2000 − 1000.
		expect(meterConsumption(meter(), '2025-01-01', '2025-12-31')).toEqual({
			value: 1000,
			estimated: false,
			exact: true,
			missing: false
		});
		// The Zwischenablesung of 30 June also serves 1 July: 1600 − 1000 and 2000 − 1600.
		expect(meterConsumption(meter(), '2025-01-01', '2025-07-01').value).toBe(600);
		expect(meterConsumption(meter(), '2025-07-01', '2025-12-31').value).toBe(400);
	});

	it('clips to the meter lifetime', () => {
		// Removed on 30 June with a final reading: only the first half counts.
		const old = meter({ removedAt: '2025-06-30' });
		expect(meterConsumption(old, '2025-01-01', '2025-12-31')).toMatchObject({
			value: 600,
			exact: true
		});
		// Installed on 30 June: only the second half.
		const replacement = meter({
			installedAt: '2025-06-30',
			readings: [reading('2025-06-30', 0), reading('2025-12-31', 400)]
		});
		expect(meterConsumption(replacement, '2025-01-01', '2025-12-31').value).toBe(400);
		// Not in service in the range at all.
		expect(meterConsumption(old, '2025-08-01', '2025-12-31')).toMatchObject({
			value: 0,
			missing: false
		});
	});

	it('reports a missing value when a bound has no readings around it', () => {
		const partial = meter({ readings: [reading('2025-01-01', 0)] });
		expect(meterConsumption(partial, '2025-01-01', '2025-12-31')).toEqual({
			value: 0,
			estimated: false,
			exact: false,
			missing: true
		});
	});

	it('propagates the estimated flag', () => {
		const estimated = meter({
			readings: [reading('2025-01-01', 0), reading('2025-12-31', 500, true)]
		});
		expect(meterConsumption(estimated, '2025-01-01', '2025-12-31')).toMatchObject({
			value: 500,
			estimated: true
		});
	});
});

describe('unitConsumption', () => {
	it('sums the meters of a unit and lists the ones without a value', () => {
		const second = meter({
			id: 'm2',
			readings: [reading('2025-01-01', 0), reading('2025-12-31', 50)]
		});
		const broken = meter({ id: 'm3', readings: [] });
		expect(unitConsumption([meter(), second, broken], '2025-01-01', '2025-12-31')).toEqual({
			value: 1050,
			estimated: false,
			missingMeterIds: ['m3'],
			unit: 'kWh'
		});
		expect(unitConsumption([], '2025-01-01', '2025-12-31')).toEqual({
			value: 0,
			estimated: false,
			missingMeterIds: [],
			unit: ''
		});
	});
});

describe('hasReadingNear', () => {
	it('needs a reading near the date on every meter in service', () => {
		expect(hasReadingNear([meter()], '2025-07-01')).toBe(true);
		expect(hasReadingNear([meter()], '2025-08-01')).toBe(false);
		const withoutInterim = meter({
			id: 'm2',
			readings: [reading('2025-01-01', 0), reading('2025-12-31', 1)]
		});
		expect(hasReadingNear([meter(), withoutInterim], '2025-07-01')).toBe(false);
		// A meter removed before the date does not need one.
		const removed = meter({ ...withoutInterim, removedAt: '2025-03-31' });
		expect(hasReadingNear([meter(), removed], '2025-07-01')).toBe(true);
		expect(hasReadingNear([], '2025-07-01')).toBe(false);
	});
});
