import {
	daysInclusive,
	firstOfMonth,
	lastOfMonth,
	type DateRange,
	type IsoDate,
	type IsoMonth
} from '../dates';
import type { ExpenseCategory, RentChargeKind } from '../server/db/schema';

// Die Auswertung: what the portfolio, a property or a unit brought in and cost over a period.
// Pure: the server module loads the rows, this computes every figure the page shows. Money that
// comes in follows the lease to its main unit; expenses belong to the unit or property they were
// booked on, and portfolio-wide ones only count when no property is filtered.

export type AnalysisProperty = { id: string; name: string };

export type AnalysisUnit = {
	id: string;
	propertyId: string;
	name: string;
	floorArea: number | null;
	/** From when the unit counts for vacancy: its creation or its first lease, whichever is first. */
	since: IsoDate;
};

export type AnalysisLease = {
	id: string;
	unitId: string;
	extraUnitIds: readonly string[];
	startDate: IsoDate;
	endDate: IsoDate | null;
};

export type AnalysisCharge = {
	leaseId: string;
	period: IsoMonth;
	kind: RentChargeKind;
	baseRent: number;
	amount: number;
};

export type AnalysisPayment = { leaseId: string; date: IsoDate; amount: number };

export type AnalysisExpense = {
	id: string;
	date: IsoDate;
	amount: number;
	category: ExpenseCategory;
	propertyId: string | null;
	unitId: string | null;
	description: string;
};

export type AnalysisDeposit = { leaseId: string; amount: number };

export type AnalysisInput = {
	properties: readonly AnalysisProperty[];
	units: readonly AnalysisUnit[];
	leases: readonly AnalysisLease[];
	charges: readonly AnalysisCharge[];
	payments: readonly AnalysisPayment[];
	expenses: readonly AnalysisExpense[];
	deposits: readonly AnalysisDeposit[];
};

export type AnalysisOptions = {
	range: DateRange;
	/** Only this property; null = the whole portfolio. */
	propertyId: string | null;
	/** Series per month (one year) or per year (several years). */
	granularity: 'month' | 'year';
	/** Vacancy is counted up to today, not into the future. */
	today: IsoDate;
};

/** Money in a period: charged (Soll), received (Ist), paid out, and what is left. */
export type Flow = { charged: number; received: number; expenses: number; net: number };

export type SeriesPoint = Flow & { key: string };

export type Occupancy = {
	/** Days the units counted in the period, vacant days among them. */
	unitDays: number;
	vacantDays: number;
	/** Vacant days × the last base rent of the unit, for units that were ever let. */
	lostRent: number;
};

export type UnitRow = Flow &
	Occupancy & {
		id: string;
		name: string;
		propertyId: string;
		propertyName: string;
		floorArea: number | null;
		baseRent: number;
		/** Average monthly base rent per m² over the charged months; null without area. */
		rentPerSqm: number | null;
	};

export type PropertyRow = Flow &
	Occupancy & {
		id: string;
		name: string;
		unitCount: number;
		floorArea: number;
		baseRent: number;
		rentPerSqm: number | null;
	};

export type Analysis = {
	totals: Flow &
		Occupancy & {
			baseRent: number;
			/** received / charged; null when nothing was charged. */
			collectionRate: number | null;
			vacancyRate: number | null;
			rentPerSqm: number | null;
			unitCount: number;
			floorArea: number;
			/** Deposits held today (all movements, whatever the period). */
			depositsHeld: number;
		};
	series: SeriesPoint[];
	byCategory: { category: ExpenseCategory; amount: number }[];
	properties: PropertyRow[];
	units: UnitRow[];
	topExpenses: AnalysisExpense[];
};

const inRange = (date: IsoDate, range: DateRange) => date >= range.start && date <= range.end;

function flow(charged: number, received: number, expenses: number): Flow {
	return { charged, received, expenses, net: received - expenses };
}

/** The keys of the series buckets from the range: YYYY-MM or YYYY. */
function bucketKeys(range: DateRange, granularity: 'month' | 'year'): string[] {
	const keys: string[] = [];
	const firstYear = Number(range.start.slice(0, 4));
	const lastYear = Number(range.end.slice(0, 4));
	for (let year = firstYear; year <= lastYear; year++) {
		if (granularity === 'year') {
			keys.push(String(year));
			continue;
		}
		for (let month = 1; month <= 12; month++) {
			const key = `${year}-${String(month).padStart(2, '0')}`;
			if (key >= range.start.slice(0, 7) && key <= range.end.slice(0, 7)) keys.push(key);
		}
	}
	return keys;
}

/** Days of `range` the sorted, merged intervals cover. */
function coveredDays(intervals: DateRange[], range: DateRange): number {
	const clipped = intervals
		.map((interval) => ({
			start: interval.start > range.start ? interval.start : range.start,
			end: interval.end < range.end ? interval.end : range.end
		}))
		.filter((interval) => interval.start <= interval.end)
		.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
	let days = 0;
	let current: DateRange | undefined;
	for (const interval of clipped) {
		if (current && interval.start <= current.end) {
			if (interval.end > current.end) current.end = interval.end;
			continue;
		}
		if (current) days += daysInclusive(current.start, current.end);
		current = { ...interval };
	}
	if (current) days += daysInclusive(current.start, current.end);
	return days;
}

export function analyse(input: AnalysisInput, options: AnalysisOptions): Analysis {
	const { range, propertyId, granularity } = options;
	const keyOf = (date: string) => (granularity === 'year' ? date.slice(0, 4) : date.slice(0, 7));

	const units = input.units.filter((unit) => !propertyId || unit.propertyId === propertyId);
	const unitById = new Map(units.map((unit) => [unit.id, unit]));
	const leaseUnit = new Map(input.leases.map((lease) => [lease.id, lease.unitId]));
	const leaseById = new Map(input.leases.map((lease) => [lease.id, lease]));
	/** Whether the lease ran the whole month, so its charge is the monthly rent, not prorated. */
	const fullMonth = (leaseId: string, period: IsoMonth) => {
		const lease = leaseById.get(leaseId);
		return Boolean(
			lease &&
			lease.startDate <= firstOfMonth(period) &&
			(lease.endDate === null || lease.endDate >= lastOfMonth(period))
		);
	};
	/** The unit a lease's money counts for, when the unit is in view. */
	const unitOfLease = (leaseId: string) => {
		const unitId = leaseUnit.get(leaseId);
		return unitId && unitById.has(unitId) ? unitId : undefined;
	};

	const perUnit = new Map(
		units.map((unit) => [
			unit.id,
			{
				charged: 0,
				received: 0,
				expenses: 0,
				baseRent: 0,
				/** Σ area over the charged months with an area, and the base rent of those months. */
				rentArea: 0,
				rentWithArea: 0,
				lastRent: null as null | { period: string; full: boolean; baseRent: number }
			}
		])
	);
	const series = new Map(
		bucketKeys(range, granularity).map((key) => [key, { charged: 0, received: 0, expenses: 0 }])
	);
	let charged = 0;
	let received = 0;
	let baseRent = 0;

	for (const charge of input.charges) {
		const unitId = unitOfLease(charge.leaseId);
		if (!unitId) continue;
		const row = perUnit.get(unitId)!;
		// The vacancy is priced at the latest full month's rent; a prorated first or last month
		// only counts when the lease never ran a whole month.
		if (charge.kind === 'rent') {
			const full = fullMonth(charge.leaseId, charge.period);
			const last = row.lastRent;
			if (!last || (full && !last.full) || (full === last.full && charge.period > last.period)) {
				row.lastRent = { period: charge.period, full, baseRent: charge.baseRent };
			}
		}
		if (charge.period < range.start.slice(0, 7) || charge.period > range.end.slice(0, 7)) continue;
		charged += charge.amount;
		row.charged += charge.amount;
		baseRent += charge.baseRent;
		row.baseRent += charge.baseRent;
		const area = unitById.get(unitId)!.floorArea;
		if (charge.kind === 'rent' && area && area > 0) {
			row.rentArea += area;
			row.rentWithArea += charge.baseRent;
		}
		const bucket = series.get(granularity === 'year' ? charge.period.slice(0, 4) : charge.period);
		if (bucket) bucket.charged += charge.amount;
	}

	for (const payment of input.payments) {
		if (!inRange(payment.date, range)) continue;
		const unitId = unitOfLease(payment.leaseId);
		if (!unitId) continue;
		received += payment.amount;
		perUnit.get(unitId)!.received += payment.amount;
		const bucket = series.get(keyOf(payment.date));
		if (bucket) bucket.received += payment.amount;
	}

	const perProperty = new Map(input.properties.map((property) => [property.id, 0]));
	const categories = new Map<ExpenseCategory, number>();
	const counted: AnalysisExpense[] = [];
	for (const expense of input.expenses) {
		if (!inRange(expense.date, range)) continue;
		if (propertyId && expense.propertyId !== propertyId) continue;
		counted.push(expense);
		categories.set(expense.category, (categories.get(expense.category) ?? 0) + expense.amount);
		if (expense.propertyId && perProperty.has(expense.propertyId)) {
			perProperty.set(expense.propertyId, perProperty.get(expense.propertyId)! + expense.amount);
		}
		if (expense.unitId) {
			const row = perUnit.get(expense.unitId);
			if (row) row.expenses += expense.amount;
		}
		const bucket = series.get(keyOf(expense.date));
		if (bucket) bucket.expenses += expense.amount;
	}
	const expenses = counted.reduce((sum, expense) => sum + expense.amount, 0);

	// Vacancy runs up to today at the latest, from when each unit counts.
	const vacancyEnd = range.end < options.today ? range.end : options.today;
	const occupiedBy = new Map<string, DateRange[]>();
	for (const lease of input.leases) {
		const interval = { start: lease.startDate, end: lease.endDate ?? '9999-12-31' };
		for (const unitId of [lease.unitId, ...lease.extraUnitIds]) {
			const list = occupiedBy.get(unitId);
			if (list) list.push(interval);
			else occupiedBy.set(unitId, [interval]);
		}
	}
	const occupancy = new Map(
		units.map((unit) => {
			const start = unit.since > range.start ? unit.since : range.start;
			const window = { start, end: vacancyEnd };
			const unitDays = start <= vacancyEnd ? daysInclusive(start, vacancyEnd) : 0;
			const vacantDays = unitDays - coveredDays(occupiedBy.get(unit.id) ?? [], window);
			const lastRent = perUnit.get(unit.id)!.lastRent;
			const lostRent = lastRent ? Math.round((vacantDays * lastRent.baseRent * 12) / 365) : 0;
			return [unit.id, { unitDays, vacantDays, lostRent }];
		})
	);

	const propertyName = new Map(input.properties.map((property) => [property.id, property.name]));
	const unitRows: UnitRow[] = units.map((unit) => {
		const row = perUnit.get(unit.id)!;
		return {
			id: unit.id,
			name: unit.name,
			propertyId: unit.propertyId,
			propertyName: propertyName.get(unit.propertyId) ?? '',
			floorArea: unit.floorArea,
			baseRent: row.baseRent,
			rentPerSqm: perSqm(row),
			...flow(row.charged, row.received, row.expenses),
			...occupancy.get(unit.id)!
		};
	});

	const propertyRows: PropertyRow[] = input.properties
		.filter((property) => !propertyId || property.id === propertyId)
		.map((property) => {
			const own = unitRows.filter((row) => row.propertyId === property.id);
			const sum = (pick: (row: UnitRow) => number) =>
				own.reduce((total, row) => total + pick(row), 0);
			const rents = own.map((row) => perUnit.get(row.id)!);
			return {
				id: property.id,
				name: property.name,
				unitCount: own.length,
				floorArea: sum((row) => row.floorArea ?? 0),
				baseRent: sum((row) => row.baseRent),
				rentPerSqm: perSqm(combine(rents)),
				...flow(
					sum((row) => row.charged),
					sum((row) => row.received),
					perProperty.get(property.id) ?? 0
				),
				unitDays: sum((row) => row.unitDays),
				vacantDays: sum((row) => row.vacantDays),
				lostRent: sum((row) => row.lostRent)
			};
		});

	const unitDays = unitRows.reduce((total, row) => total + row.unitDays, 0);
	const vacantDays = unitRows.reduce((total, row) => total + row.vacantDays, 0);
	const leaseIdsInView = new Set(
		input.leases.filter((lease) => unitById.has(lease.unitId)).map((lease) => lease.id)
	);

	return {
		totals: {
			...flow(charged, received, expenses),
			baseRent,
			collectionRate: charged > 0 ? received / charged : null,
			unitDays,
			vacantDays,
			vacancyRate: unitDays > 0 ? vacantDays / unitDays : null,
			lostRent: unitRows.reduce((total, row) => total + row.lostRent, 0),
			rentPerSqm: perSqm(combine([...perUnit.values()])),
			unitCount: units.length,
			floorArea: units.reduce((total, unit) => total + (unit.floorArea ?? 0), 0),
			depositsHeld: input.deposits
				.filter((deposit) => leaseIdsInView.has(deposit.leaseId))
				.reduce((total, deposit) => total + deposit.amount, 0)
		},
		series: [...series].map(([key, point]) => ({
			key,
			...flow(point.charged, point.received, point.expenses)
		})),
		byCategory: [...categories]
			.map(([category, amount]) => ({ category, amount }))
			.sort((a, b) => b.amount - a.amount),
		properties: propertyRows,
		units: unitRows,
		topExpenses: [...counted].sort((a, b) => b.amount - a.amount).slice(0, 5)
	};
}

type RentArea = { rentArea: number; rentWithArea: number };

/** Euro of base rent per m² and month, over the months that had an area. */
function perSqm(rent: RentArea): number | null {
	return rent.rentArea > 0 ? rent.rentWithArea / 100 / rent.rentArea : null;
}

function combine(rents: readonly RentArea[]): RentArea {
	return rents.reduce(
		(total, rent) => ({
			rentArea: total.rentArea + rent.rentArea,
			rentWithArea: total.rentWithArea + rent.rentWithArea
		}),
		{ rentArea: 0, rentWithArea: 0 }
	);
}
