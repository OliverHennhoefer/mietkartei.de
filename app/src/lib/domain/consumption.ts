import { addDays, daysBetween, overlap, type DateRange, type IsoDate } from '../dates';
import type { MeterKind } from '../server/db/schema';

// Consumption from meter readings. A meter has readings on dates; the value on any other day is
// interpolated between the readings around it. A reading within three days of the day asked for
// counts as taken on that day, so a Zwischenablesung on 30 June serves both the lease ending that
// day and the one starting on 1 July (§ 9b HeizKV). Consumption is clipped to the meter's
// lifetime, so a replaced meter contributes what it measured before it was removed and the new
// one what it measured since it was installed.

export type Reading = {
	readAt: IsoDate;
	value: number;
	/** An estimate standing in for a missing reading (§ 9a HeizKV). */
	estimated: boolean;
};

export type Meter = {
	id: string;
	/** Null for a building meter. */
	unitId: string | null;
	kind: MeterKind;
	serialNumber?: string | null;
	/** kWh, m³ or Einheiten. */
	unit: string;
	installedAt: IsoDate | null;
	removedAt: IsoDate | null;
	readings: Reading[];
};

/** A reading this many days before or after a date is used as the reading on that date. */
const EXACT_READING_DAYS = 3;

const FOREVER: DateRange = { start: '0000-01-01', end: '9999-12-31' };

function sortReadings(readings: readonly Reading[]): Reading[] {
	return [...readings].sort((a, b) => (a.readAt < b.readAt ? -1 : a.readAt > b.readAt ? 1 : 0));
}

/** The reading nearest to the date, within EXACT_READING_DAYS; the earlier one wins a tie. */
export function readingNear(readings: readonly Reading[], date: IsoDate): Reading | undefined {
	let best: Reading | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const reading of sortReadings(readings)) {
		const distance = Math.abs(daysBetween(reading.readAt, date));
		if (distance <= EXACT_READING_DAYS && distance < bestDistance) {
			best = reading;
			bestDistance = distance;
		}
	}
	return best;
}

export type MeterValue = {
	value: number;
	/** At least one of the readings used is an estimate. */
	estimated: boolean;
	/** A reading near the date was used, nothing interpolated. */
	exact: boolean;
	/** The reading's date when exact. */
	readAt?: IsoDate;
};

/**
 * The meter's value on a date: the reading near it, else linear interpolation between the last
 * reading before and the first after. Undefined when there is no reading on one side.
 */
export function valueAt(readings: readonly Reading[], date: IsoDate): MeterValue | undefined {
	const near = readingNear(readings, date);
	if (near)
		return { value: near.value, estimated: near.estimated, exact: true, readAt: near.readAt };
	let before: Reading | undefined;
	let after: Reading | undefined;
	for (const reading of sortReadings(readings)) {
		if (reading.readAt < date) before = reading;
		else if (reading.readAt > date && !after) after = reading;
	}
	if (!before || !after) return undefined;
	const span = daysBetween(before.readAt, after.readAt);
	const value =
		before.value + ((after.value - before.value) * daysBetween(before.readAt, date)) / span;
	return { value, estimated: before.estimated || after.estimated, exact: false };
}

export function lifetime(meter: Pick<Meter, 'installedAt' | 'removedAt'>): DateRange {
	return { start: meter.installedAt ?? FOREVER.start, end: meter.removedAt ?? FOREVER.end };
}

export type Consumption = {
	value: number;
	estimated: boolean;
	/** Both bounds come from readings near them. */
	exact: boolean;
	/** No usable value on at least one bound. The value is 0 then. */
	missing: boolean;
};

const none: Consumption = { value: 0, estimated: false, exact: true, missing: false };

/**
 * What the meter counted from `from` to `to`: its value on `to` minus its value on `from`, both
 * dates clipped to the meter's lifetime. A meter not in service between the dates reads 0.
 */
export function meterConsumption(meter: Meter, from: IsoDate, to: IsoDate): Consumption {
	const clipped = overlap({ start: from, end: to }, lifetime(meter));
	if (!clipped || clipped.start >= clipped.end) return none;
	const start = valueAt(meter.readings, clipped.start);
	const end = valueAt(meter.readings, clipped.end);
	if (!start || !end) return { value: 0, estimated: false, exact: false, missing: true };
	return {
		value: end.value - start.value,
		estimated: start.estimated || end.estimated,
		exact: start.exact && end.exact,
		missing: false
	};
}

/**
 * Whether a reading the meter's consumption from `from` to `to` rests on is lower than the one
 * before it: a typo or a replaced meter entered as a new reading. The consumption would come out
 * too low or negative, and the allocation would shift the cost onto the other units.
 */
export function readingsDecrease(meter: Meter, from: IsoDate, to: IsoDate): boolean {
	const clipped = overlap({ start: from, end: to }, lifetime(meter));
	if (!clipped || clipped.start >= clipped.end) return false;
	// The readings around the period count too: the values on its bounds come from them.
	const start = addDays(clipped.start, -EXACT_READING_DAYS);
	const end = addDays(clipped.end, EXACT_READING_DAYS);
	const readings = sortReadings(meter.readings);
	return readings.some((reading, index) => {
		const previous = readings[index - 1];
		return (
			previous !== undefined &&
			reading.readAt >= start &&
			previous.readAt <= end &&
			reading.value < previous.value
		);
	});
}

export type UnitConsumption = {
	value: number;
	estimated: boolean;
	/** Meters without a usable value on a bound; the unit's value is incomplete while any exist. */
	missingMeterIds: string[];
	/** Meters with a reading lower than the one before it in the period (see readingsDecrease). */
	decreasingMeterIds: string[];
	/** The unit of measure of the first meter, '' without meters. */
	unit: string;
};

/** The consumption of a unit: the sum over its meters of one kind. */
export function unitConsumption(meters: readonly Meter[], from: IsoDate, to: IsoDate) {
	const result: UnitConsumption = {
		value: 0,
		estimated: false,
		missingMeterIds: [],
		decreasingMeterIds: [],
		unit: meters[0]?.unit ?? ''
	};
	for (const meter of meters) {
		const consumption = meterConsumption(meter, from, to);
		if (consumption.missing) result.missingMeterIds.push(meter.id);
		if (readingsDecrease(meter, from, to)) result.decreasingMeterIds.push(meter.id);
		result.value += consumption.value;
		result.estimated ||= consumption.estimated;
	}
	return result;
}

/** Whether the meter is in service on the day. */
function inService(meter: Pick<Meter, 'installedAt' | 'removedAt'>, date: IsoDate) {
	const range = lifetime(meter);
	return range.start <= date && date <= range.end;
}

/**
 * Whether every meter in service on the date has a reading near it: the Zwischenablesung that
 * lets a tenant change be settled by consumption instead of by Gradtagszahlen or days.
 */
export function hasReadingNear(meters: readonly Meter[], date: IsoDate): boolean {
	const active = meters.filter((meter) => inService(meter, date));
	return active.length > 0 && active.every((meter) => readingNear(meter.readings, date));
}
