import {
	addDays,
	addMonths,
	daysInclusive,
	formatDate,
	lastOfMonth,
	monthOf,
	monthsInRange,
	overlap,
	overlapDays,
	today as berlinToday,
	type DateRange,
	type IsoDate,
	type IsoMonth
} from '../dates';
import { formatArea, formatNumber, personName } from '../format';
import { meterKindLabels } from '../labels';
import { distributeCents, formatCents, proRata } from '../money';
import type {
	AllocationKeyKind,
	BuildingUse,
	Fuel,
	HeatingCostModel,
	LeaseKind,
	MeterKind,
	OperatingCostModel,
	RentChargeKind
} from '../server/db/schema';
import type { UnitKind } from '../units';
import { splitCo2Cost } from './co2';
import { hasReadingNear, meterConsumption, unitConsumption, type Meter } from './consumption';
import { degreeDays } from './degree-days';
import { monthlyAmounts, type RentChange } from './rents';

// The operating cost statement (Betriebskostenabrechnung), pure: everything the computation
// needs is passed in, nothing is read from the database. Step 1 takes each cost item's share of
// the period less the landlord's CO₂ share (CO2KostAufG), steps 2–4 weigh the units by the allocation key and split each unit's share between
// the leases that occupied it in turn, step 5 sets the paid prepayments against each lease's
// costs and step 6 checks the deadline and the HeizKV. The server module freezes the result on
// approval and the PDF prints the per-lease part.

/** § 556 Abs. 3 BGB: at most one year per statement. */
const MAX_PERIOD_MONTHS = 12;
/** § 556 Abs. 3 BGB: the statement must reach the tenant within a year after the period. */
const DEADLINE_MONTHS = 12;
/** § 556 Abs. 3 Satz 5 BGB: the tenant may object within a year after receiving it. */
const OBJECTION_MONTHS = 12;
/** A WEG share that differs from its key by more than this (cents) is pointed out. */
const ASSOCIATION_TOLERANCE = 100;
/** § 9a Abs. 2 HeizKV: estimated consumption for more than a quarter of the area is a problem. */
const ESTIMATED_AREA_LIMIT = 0.25;
/** §§ 7, 8 HeizKV: the share of heating and hot water cost that must follow consumption. */
const HEIZKV_CONSUMPTION_PERCENT = { min: 50, max: 70 };

// Input

export type StatementProperty = {
	id: string;
	name: string;
	street: string;
	postalCode: string;
	city: string;
	vacancyPersons: number;
	buildingUse: BuildingUse;
};

export type StatementUnit = {
	id: string;
	name: string;
	kind: UnitKind;
	floorArea: number | null;
};

export type StatementTenant = {
	salutation: string | null;
	firstName: string;
	lastName: string;
	street: string | null;
	postalCode: string | null;
	city: string | null;
};

export type PersonsEntry = { validFrom: IsoDate; persons: number };

/** A charge on the lease's rent account, as far as the paid prepayments need it. */
export type LedgerCharge = {
	kind: RentChargeKind;
	period: IsoMonth;
	/** Null while not due (a Nachzahlung before its statement reached the tenant). */
	dueDate: IsoDate | null;
	/** Positive = owed, negative = a credit. */
	amount: number;
	/** The prepayments of a `rent` charge (or the Pauschale of a lease without prepayments). */
	operatingCostPrepayment: number;
	heatingCostPrepayment: number;
};

/** A payment on the lease's rent account; positive = received, negative = refunded. */
export type LedgerPayment = { date: IsoDate; amount: number };

export type StatementLease = {
	id: string;
	kind: LeaseKind;
	startDate: IsoDate;
	endDate: IsoDate | null;
	operatingCostModel: OperatingCostModel;
	heatingCostModel: HeatingCostModel;
	ledgerStart: IsoDate | null;
	/** The main unit and the extra units, as far as they belong to the property. */
	unitIds: string[];
	tenants: StatementTenant[];
	persons: PersonsEntry[];
	rentHistory: RentChange[];
	/**
	 * The lease's rent account: every charge but the postings of the statements of this property
	 * and period (a correction replaces them), and every payment.
	 */
	charges: LedgerCharge[];
	payments: LedgerPayment[];
};

export type StatementCategory = {
	id: string;
	name: string;
	betrkvItem: number | null;
	allocable: boolean;
	/** Heating, hot water: the HeizKV applies and Pauschale rules treat the item as heating. */
	consumptionBased: boolean;
};

export type StatementKey = {
	id: string;
	name: string;
	kind: AllocationKeyKind;
	meterKind: MeterKind | null;
	consumptionPercent: number | null;
	shares: { unitId: string; share: number }[];
};

export type StatementCircle = { id: string; name: string; unitIds: string[] };

export type StatementItem = {
	id: string;
	description: string;
	supplier: string | null;
	categoryId: string;
	allocationKeyId: string;
	billingCircleId: string | null;
	periodStart: IsoDate;
	periodEnd: IsoDate;
	amount: number;
	allocable: boolean;
	fuel: Fuel | null;
	fuelKwh: number | null;
	co2Kg: number | null;
	co2Cost: number | null;
	/** For a `direct` key: the amount of each unit. */
	unitAmounts: { unitId: string; amount: number }[];
	/** For a cost of a WEG: how the Verwalter arrived at `amount`. */
	association: AssociationShare | null;
};

/**
 * A cost of a WEG from the Hausgeldabrechnung: the cost of the whole WEG and the key the
 * Verwalter split it by, e.g. 4200 € by MEA, 85 of 1000; the item's amount is the property's share.
 */
export type AssociationShare = {
	/** Cents, for the item's whole period. */
	total: number;
	/** E.g. `MEA`. */
	key: string;
	keyTotal: number;
	keyShare: number;
};

export type Landlord = {
	name: string;
	street: string | null;
	postalCode: string | null;
	city: string | null;
	iban: string | null;
	bankName: string | null;
};

export type StatementInput = {
	property: StatementProperty;
	period: DateRange;
	units: StatementUnit[];
	leases: StatementLease[];
	items: StatementItem[];
	categories: StatementCategory[];
	keys: StatementKey[];
	circles: StatementCircle[];
	meters: Meter[];
	landlord: Landlord;
};

export type StatementOptions = {
	/** The current date; defaults to today in Berlin. */
	today?: IsoDate;
};

// Result

export type WarningCode =
	| 'missing_area'
	| 'co2_missing_area'
	| 'missing_meter'
	| 'missing_reading'
	| 'estimated_reading'
	| 'estimated_share'
	| 'no_interim_reading'
	| 'no_lease'
	| 'heizkv_key'
	| 'missing_share'
	| 'direct_mismatch'
	| 'no_weight'
	| 'flat_lease'
	| 'deadline_passed'
	| 'unknown_key'
	| 'unknown_category'
	| 'association_mismatch';

/** A finding of the computation; the draft page links `href` as the way to fix it. */
export type StatementWarning = {
	code: WarningCode;
	message: string;
	href?: string;
	/** The statement cannot be approved while this stands. */
	blocking: boolean;
	unitId?: string;
	leaseId?: string;
	meterId?: string;
	itemId?: string;
};

export type Co2Disclosure = {
	fuel: Fuel;
	fuelKwh: number | null;
	/** The kg printed on this bill. */
	co2Kg: number;
	/**
	 * The emissions per year of the circle (or property) the tier is computed from: the kg of all
	 * its fuel bills in the period, scaled to the twelve months from the period start.
	 */
	buildingCo2Kg: number;
	/** The CO₂ cost in the period, cents. */
	co2Cost: number;
	/** Floor area the emissions are measured against (the circle's or the property's), m². */
	area: number;
	kgPerSquareMetre: number;
	landlordPercent: number;
	landlordAmount: number;
	tenantAmount: number;
};

/** How a unit's consumption was split between the leases that occupied it in turn. */
export type SplitMethod = 'readings' | 'degree_days' | 'days';

export type CostLine = {
	itemId: string;
	description: string;
	supplier: string | null;
	categoryName: string;
	betrkvItem: number | null;
	keyName: string;
	keyKind: AllocationKeyKind;
	/** The item counts as heating cost (Pauschale rules, HeizKV). */
	heating: boolean;
	/** The item's cost in the period (Gesamtkosten). */
	itemTotal: number;
	/** What is allocated to the units: the total after the landlord's CO₂ share. */
	allocated: number;
	/** The key's total, e.g. `184,5 m²`, `1.641 Personentage`, `3 Einheiten`, `2.200 kWh`. */
	keyTotal: string;
	/** The lease's share of the key, e.g. `72,5 m² von 184,5 m² · 365 von 365 Tagen`. */
	share: string;
	/** Set when the unit changed tenants in the period and the item follows consumption. */
	method?: SplitMethod;
	/** The lease's share in cents (Dein Anteil). */
	amount: number;
	co2?: Co2Disclosure;
	/** For a cost of a WEG: its figures, the total prorated to the period like `itemTotal`. */
	association?: AssociationShare;
};

/** A share the lease would have had, kept by the landlord because of a Pauschale. */
export type ExcludedLine = {
	itemId: string;
	description: string;
	categoryName: string;
	amount: number;
	reason: string;
};

export type PrepaymentMonth = {
	period: IsoMonth;
	/** The prepayments charged for the month (Soll). */
	charged: number;
	/** What the tenant paid of them (geleistet), operating and heating cost apart. */
	operatingCostPrepayment: number;
	heatingCostPrepayment: number;
	/** The paid prepayments of the month, the amount the statement credits. */
	amount: number;
	/**
	 * From the rent account, or from the rent history for a month before the rent account starts
	 * (counted as paid; arrears from before are in the opening balance).
	 */
	source: 'ledger' | 'history';
};

export type PersonsPeriod = { from: IsoDate; to: IsoDate; persons: number };

/** The frozen per-lease result (statement_results.result); the PDF prints exactly this. */
export type LeaseStatement = {
	leaseId: string;
	leaseKind: LeaseKind;
	property: { name: string; street: string; postalCode: string; city: string };
	period: { start: IsoDate; end: IsoDate; days: number };
	landlord: Landlord;
	tenants: StatementTenant[];
	units: { id: string; name: string; floorArea: number | null }[];
	/** The part of the period the lease ran. */
	occupancy: { start: IsoDate; end: IsoDate; days: number };
	persons: PersonsPeriod[];
	lines: CostLine[];
	excluded: ExcludedLine[];
	prepayments: PrepaymentMonth[];
	costsTotal: number;
	/** The paid prepayments (geleistete Vorauszahlungen). */
	prepaymentsTotal: number;
	/**
	 * Prepayments charged on the rent account but not paid. The balance contains them, so the
	 * posting of the balance takes them off the rent account, where they would count twice.
	 */
	unpaidPrepayments: number;
	/** costs − paid prepayments; positive = Nachzahlung, negative = Guthaben. */
	balance: number;
	/** § 556 Abs. 3 BGB: the statement must reach the tenant by this day. */
	deadline: IsoDate;
	/** The deadline had passed when the statement was computed (residential leases only). */
	late: boolean;
	warnings: StatementWarning[];
	/** Set on approval. */
	approvedOn: IsoDate | null;
	/**
	 * Set on approval for a Guthaben (or nothing to pay): 30 days after the approval. A Nachzahlung
	 * is due 30 days after the statement reached the tenant, so it has no date here.
	 */
	dueDate: IsoDate | null;
	/**
	 * Set on approval: what the statement claims, the balance or, after the deadline, less (0 for
	 * a late residential Nachzahlung).
	 */
	posted: number | null;
};

export type PropertyItem = {
	itemId: string;
	description: string;
	categoryName: string;
	keyName: string;
	keyKind: AllocationKeyKind;
	/** Cost in the period. */
	total: number;
	allocable: boolean;
	/**
	 * Distributed over the units: the total less the landlord's CO₂ share and what no weight
	 * carries, or what the amounts of a `direct` key add up to.
	 */
	allocated: number;
	landlordCo2Share: number;
	vacancyShare: number;
	excludedShare: number;
	/**
	 * Not distributed: a `direct` key whose unit amounts do not add up to the item, or a key that
	 * gives no unit (or no lease of a unit) a weight.
	 */
	unallocated: number;
	co2?: Co2Disclosure;
};

export type LeaseTotals = {
	leaseId: string;
	label: string;
	units: string;
	tenants: string;
	costsTotal: number;
	prepaymentsTotal: number;
	balance: number;
};

/** The property-level result (operating_cost_statements.result), frozen on approval. */
export type PropertyResult = {
	propertyId: string;
	propertyName: string;
	period: { start: IsoDate; end: IsoDate; days: number };
	items: PropertyItem[];
	costsTotal: number;
	allocableTotal: number;
	nonAllocableTotal: number;
	landlordCo2Share: number;
	vacancyShare: number;
	/** Shares kept by the landlord because of Pauschale and Inklusivmiete leases. */
	excludedTotal: number;
	unallocatedTotal: number;
	leases: LeaseTotals[];
	leaseCount: number;
	/** Sum of the positive balances. */
	nachzahlungen: number;
	/** Sum of the negative balances, as a positive number. */
	guthaben: number;
	deadline: IsoDate;
	late: boolean;
	warnings: StatementWarning[];
	approvedOn: IsoDate | null;
};

export type StatementResult = { property: PropertyResult; leases: LeaseStatement[] };

// Small helpers shared with the pages

/** The German message when the period is not a valid statement period, else undefined. */
export function validatePeriod(start: IsoDate, end: IsoDate): string | undefined {
	if (end < start) return 'Das Ende des Zeitraums liegt vor dem Beginn.';
	// Prepayments are charged per month; a period that cuts a month would count it in full.
	if (!start.endsWith('-01') || end !== lastOfMonth(monthOf(end))) {
		return 'Der Abrechnungszeitraum muss am Ersten eines Monats beginnen und am Letzten eines Monats enden.';
	}
	if (addMonths(start, MAX_PERIOD_MONTHS) <= end) {
		return `Der Abrechnungszeitraum darf höchstens ${MAX_PERIOD_MONTHS} Monate umfassen (§ 556 Abs. 3 BGB).`;
	}
	return undefined;
}

/**
 * The end of the twelfth month after the day: § 556 Abs. 3 BGB counts both the statement
 * deadline (after the period end) and the Einwendungsfrist (after the receipt) to the end of
 * that month ("bis zum Ablauf des zwölften Monats").
 */
function endOfTwelfthMonth(day: IsoDate, months: number): IsoDate {
	return lastOfMonth(monthOf(addMonths(day, months)));
}

/** § 556 Abs. 3 Satz 2 BGB: the statement must reach the tenant by this day. */
export function statementDeadline(periodEnd: IsoDate): IsoDate {
	return endOfTwelfthMonth(periodEnd, DEADLINE_MONTHS);
}

/** § 556 Abs. 3 Satz 5 BGB: the tenant may object until this day. */
export function objectionDeadline(deliveredOn: IsoDate): IsoDate {
	return endOfTwelfthMonth(deliveredOn, OBJECTION_MONTHS);
}

/** `2025` for a calendar year, else `01.07.2025 – 30.06.2026`. */
export function periodLabel(start: IsoDate, end: IsoDate): string {
	if (start.endsWith('-01-01') && end === `${start.slice(0, 4)}-12-31`) return start.slice(0, 4);
	return `${formatDate(start)} – ${formatDate(end)}`;
}

export function balanceLabel(balance: number): 'Nachzahlung' | 'Guthaben' | 'ausgeglichen' {
	return balance > 0 ? 'Nachzahlung' : balance < 0 ? 'Guthaben' : 'ausgeglichen';
}

/**
 * § 560 Abs. 4 BGB: the monthly prepayments the statement suggests, a twelfth of the year's
 * costs, split into operating and heating cost like the two prepayment columns. A lease that ran
 * only part of the period is scaled to a full year. Null for a kind without a line (a Pauschale,
 * or no such cost), so the current prepayment stays.
 */
export function suggestedPrepayments(lease: LeaseStatement): {
	operating: number | null;
	heating: number | null;
} {
	const days = Math.min(Math.max(lease.occupancy.days, 1), 365);
	const monthly = (heating: boolean) => {
		const lines = lease.lines.filter((line) => line.heating === heating);
		if (lines.length === 0) return null;
		const total = lines.reduce((sum, line) => sum + line.amount, 0);
		return Math.max(0, proRata(total, 365, days * 12));
	};
	return { operating: monthly(false), heating: monthly(true) };
}

/** The lease's label in the statement: unit names, then the tenants. */
export function leaseLabel(units: { name: string }[], tenants: StatementTenant[]): string {
	const names = tenants.map(personName).join(', ');
	const unitNames = units.map((unit) => unit.name).join(' + ');
	return names ? `${unitNames} · ${names}` : unitNames;
}

// Occupancy

function term(lease: StatementLease): DateRange {
	return { start: lease.startDate, end: lease.endDate ?? '9999-12-31' };
}

/** The persons of the lease on a day: the latest entry valid by then, else the earliest one. */
export function personsOn(entries: readonly PersonsEntry[], day: IsoDate): number {
	let current: PersonsEntry | undefined;
	let earliest: PersonsEntry | undefined;
	for (const entry of entries) {
		if (!earliest || entry.validFrom < earliest.validFrom) earliest = entry;
		if (entry.validFrom <= day && (!current || entry.validFrom >= current.validFrom)) {
			current = entry;
		}
	}
	return (current ?? earliest)?.persons ?? 1;
}

/** The persons of the lease as periods within its occupancy, for the statement. */
function personsPeriods(lease: StatementLease, range: DateRange): PersonsPeriod[] {
	const periods: PersonsPeriod[] = [];
	for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
		const persons = personsOn(lease.persons, day);
		const last = periods.at(-1);
		if (last && last.persons === persons) last.to = day;
		else periods.push({ from: day, to: day, persons });
	}
	return periods;
}

type Occupant = { lease: StatementLease; range: DateRange; days: number; personDays: number };

type Segment = { start: IsoDate; end: IsoDate; leaseId: string | null };

type UnitOccupancy = {
	unit: StatementUnit;
	/** In order of their start. */
	leases: Occupant[];
	vacancyDays: number;
	vacancyPersonDays: number;
	/** The period cut at every lease start and end; each piece has one occupant or none. */
	segments: Segment[];
};

function occupancyOf(
	unit: StatementUnit,
	leases: readonly StatementLease[],
	period: DateRange,
	vacancyPersons: number
): UnitOccupancy {
	const occupants: Occupant[] = [];
	for (const lease of leases) {
		if (!lease.unitIds.includes(unit.id)) continue;
		const range = overlap(period, term(lease));
		if (!range) continue;
		occupants.push({ lease, range, days: daysInclusive(range.start, range.end), personDays: 0 });
	}
	occupants.sort(
		(a, b) => a.range.start.localeCompare(b.range.start) || a.lease.id.localeCompare(b.lease.id)
	);

	let vacancyDays = 0;
	for (let day = period.start; day <= period.end; day = addDays(day, 1)) {
		let covered = false;
		for (const occupant of occupants) {
			if (occupant.range.start <= day && day <= occupant.range.end) {
				covered = true;
				occupant.personDays += personsOn(occupant.lease.persons, day);
			}
		}
		if (!covered) vacancyDays += 1;
	}

	const cuts = new Set<IsoDate>([period.start]);
	for (const occupant of occupants) {
		cuts.add(occupant.range.start);
		const next = addDays(occupant.range.end, 1);
		if (next <= period.end) cuts.add(next);
	}
	const sorted = [...cuts].sort();
	const segments: Segment[] = [];
	sorted.forEach((start, index) => {
		const end = index + 1 < sorted.length ? addDays(sorted[index + 1], -1) : period.end;
		const occupant = occupants.find(
			(candidate) => candidate.range.start <= start && start <= candidate.range.end
		);
		const leaseId = occupant?.lease.id ?? null;
		const last = segments.at(-1);
		if (last && last.leaseId === leaseId) last.end = end;
		else segments.push({ start, end, leaseId });
	});

	return {
		unit,
		leases: occupants,
		vacancyDays,
		vacancyPersonDays: vacancyDays * vacancyPersons,
		segments
	};
}

// Consumption of a unit and its split between the leases

type UnitUsage = {
	value: number;
	estimated: boolean;
	unit: string;
	missingMeterIds: string[];
	noMeter: boolean;
};

type UsageSplit = {
	method?: SplitMethod;
	/** One weight per occupant in UnitOccupancy.leases order, then the vacancy. */
	weights: number[];
	/** The consumption or the share attributed to each occupant, for the share text. */
	detail: string[];
};

function usageSplit(
	occupancy: UnitOccupancy,
	meters: readonly Meter[],
	meterKind: MeterKind,
	usage: UnitUsage,
	period: DateRange
): UsageSplit {
	const occupants = occupancy.leases;
	const index = (leaseId: string | null) =>
		leaseId === null ? occupants.length : occupants.findIndex((o) => o.lease.id === leaseId);
	const weights = new Array<number>(occupants.length + 1).fill(0);

	if (occupancy.segments.length <= 1) {
		weights[index(occupancy.segments[0]?.leaseId ?? null)] = 1;
		return { weights, detail: occupants.map(() => '') };
	}

	const cuts = occupancy.segments.slice(1).map((segment) => segment.start);
	const interim = cuts.every((cut) => hasReadingNear(meters, cut));
	let method: SplitMethod;
	if (interim) {
		method = 'readings';
		occupancy.segments.forEach((segment, i) => {
			const next = occupancy.segments[i + 1];
			const to = next ? next.start : period.end;
			let value = 0;
			for (const meter of meters) value += meterConsumption(meter, segment.start, to).value;
			weights[index(segment.leaseId)] += value;
		});
	} else {
		method = meterKind === 'heat' ? 'degree_days' : 'days';
		for (const segment of occupancy.segments) {
			weights[index(segment.leaseId)] +=
				method === 'degree_days' ? degreeDays(segment) : daysInclusive(segment.start, segment.end);
		}
	}

	const total = weights.reduce((sum, weight) => sum + weight, 0);
	const detail = occupants.map((occupant, i) => {
		if (method === 'readings') {
			return `davon ${formatNumber(weights[i])} ${usage.unit} laut Zwischenablesung`;
		}
		if (method === 'degree_days') {
			const percent = total > 0 ? formatNumber((weights[i] / total) * 100, 1) : '0';
			return `davon ${percent} % nach Gradtagszahlen`;
		}
		return `davon ${occupant.days} von ${daysInclusive(period.start, period.end)} Tagen`;
	});
	return { method, weights, detail };
}

// The computation

type Component = {
	amount: number;
	/** Prefix for the share text of a mixed key, e.g. `70 % nach Verbrauch: `; '' otherwise. */
	label: string;
	keyTotal: string;
	/** One per circle unit; ignored when `direct` is set. */
	weights: number[];
	/** Amounts per circle unit for a `direct` key. */
	direct?: number[];
	unitShare: (unitIndex: number) => string;
	splitBy: 'days' | 'persons' | 'consumption';
	/** Per circle unit, when splitBy is consumption. */
	usageSplits?: UsageSplit[];
};

type Context = {
	input: StatementInput;
	period: DateRange;
	today: IsoDate;
	warnings: StatementWarning[];
	/** The leases that ran in the period. */
	leases: StatementLease[];
	/** Over the whole period, by unit. */
	occupancies: Map<string, UnitOccupancy>;
	/** Over the part of the period an item covers, by unit and range. */
	rangeOccupancies: Map<string, UnitOccupancy>;
	metersByUnit: Map<string, Meter[]>;
	usageCache: Map<string, UnitUsage>;
	splitCache: Map<string, UsageSplit>;
};

function warn(ctx: Context, warning: StatementWarning): void {
	// The same finding is reported once, however many items run into it.
	const duplicate = ctx.warnings.some(
		(existing) =>
			existing.code === warning.code &&
			existing.unitId === warning.unitId &&
			existing.leaseId === warning.leaseId &&
			existing.meterId === warning.meterId &&
			existing.itemId === warning.itemId
	);
	if (!duplicate) ctx.warnings.push(warning);
}

function metersOf(ctx: Context, unitId: string, kind: MeterKind): Meter[] {
	return (ctx.metersByUnit.get(unitId) ?? []).filter((meter) => meter.kind === kind);
}

function meterLabel(meter: Meter): string {
	return meter.serialNumber
		? `${meterKindLabels[meter.kind]} ${meter.serialNumber}`
		: meterKindLabels[meter.kind];
}

function zaehlerHref(ctx: Context, meterId?: string): string {
	const base = `/objekte/${ctx.input.property.id}/zaehler`;
	return meterId ? `${base}?meter=${meterId}` : base;
}

/** The unit's consumption of a meter kind in the period, with the warnings it raises. */
function usageOf(ctx: Context, unit: StatementUnit, kind: MeterKind): UnitUsage {
	const cacheKey = `${unit.id}:${kind}`;
	const cached = ctx.usageCache.get(cacheKey);
	if (cached) return cached;

	const meters = metersOf(ctx, unit.id, kind);
	const consumption = unitConsumption(meters, ctx.period.start, ctx.period.end);
	const usage: UnitUsage = { ...consumption, noMeter: meters.length === 0 };
	ctx.usageCache.set(cacheKey, usage);

	// A parking space has no meter of its own; its share of a consumption key is 0 without a word.
	if (usage.noMeter && unit.kind !== 'parking') {
		warn(ctx, {
			code: 'missing_meter',
			blocking: true,
			unitId: unit.id,
			href: zaehlerHref(ctx),
			message: `Die Einheit ${unit.name} hat keinen Zähler für ${meterKindLabels[kind]}; ohne Verbrauch kann die Abrechnung nicht freigegeben werden.`
		});
	}
	for (const meterId of usage.missingMeterIds) {
		const meter = meters.find((candidate) => candidate.id === meterId)!;
		warn(ctx, {
			code: 'missing_reading',
			blocking: true,
			unitId: unit.id,
			meterId,
			href: zaehlerHref(ctx, meterId),
			message: `Für den Zähler ${meterLabel(meter)} der Einheit ${unit.name} fehlt ein Zählerstand am Anfang oder Ende des Zeitraums; erfasse einen Stand oder eine Schätzung (§ 9a HeizKV).`
		});
	}
	if (usage.estimated) {
		warn(ctx, {
			code: 'estimated_reading',
			blocking: false,
			unitId: unit.id,
			href: zaehlerHref(ctx, meters[0]?.id),
			message: `Der Verbrauch der Einheit ${unit.name} (${meterKindLabels[kind]}) beruht auf einem geschätzten Zählerstand (§ 9a HeizKV).`
		});
	}
	return usage;
}

function splitOf(ctx: Context, unit: StatementUnit, kind: MeterKind, usage: UnitUsage): UsageSplit {
	const cacheKey = `${unit.id}:${kind}`;
	const cached = ctx.splitCache.get(cacheKey);
	if (cached) return cached;
	const occupancy = ctx.occupancies.get(unit.id)!;
	const meters = metersOf(ctx, unit.id, kind);
	const split = usageSplit(occupancy, meters, kind, usage, ctx.period);
	ctx.splitCache.set(cacheKey, split);
	if (split.method && split.method !== 'readings') {
		warn(ctx, {
			code: 'no_interim_reading',
			blocking: false,
			unitId: unit.id,
			href: zaehlerHref(ctx, meters[0]?.id),
			message: `Beim Wechsel in der Einheit ${unit.name} fehlt eine Zwischenablesung für ${meterKindLabels[kind]}; der Verbrauch wird nach ${split.method === 'degree_days' ? 'Gradtagszahlen' : 'Tagen'} aufgeteilt.`
		});
	}
	return split;
}

/**
 * The unit's occupancy over the part of the period a cost item covers: an item for January to
 * September is shared by the leases (and the vacancy) of those months only, by their days or
 * person-days within them.
 */
function occupancyIn(ctx: Context, unit: StatementUnit, range: DateRange): UnitOccupancy {
	if (range.start === ctx.period.start && range.end === ctx.period.end) {
		return ctx.occupancies.get(unit.id)!;
	}
	const cacheKey = `${unit.id}:${range.start}:${range.end}`;
	const cached = ctx.rangeOccupancies.get(cacheKey);
	if (cached) return cached;
	const occupancy = occupancyOf(unit, ctx.leases, range, ctx.input.property.vacancyPersons);
	ctx.rangeOccupancies.set(cacheKey, occupancy);
	return occupancy;
}

function daysText(occupant: Occupant, rangeDays: number): string {
	return `${occupant.days} von ${rangeDays} Tagen`;
}

function areaComponent(
	ctx: Context,
	amount: number,
	circleUnits: StatementUnit[],
	label: string
): Component {
	const weights = circleUnits.map((unit) => {
		if (unit.floorArea === null && unit.kind !== 'parking') {
			warn(ctx, {
				code: 'missing_area',
				blocking: false,
				unitId: unit.id,
				href: `/objekte/${ctx.input.property.id}/einheiten/${unit.id}/bearbeiten`,
				message: `Für die Einheit ${unit.name} fehlt die Wohnfläche; sie erhält keinen Anteil nach Fläche.`
			});
		}
		return unit.floorArea ?? 0;
	});
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	return {
		amount,
		label,
		keyTotal: formatArea(total),
		weights,
		unitShare: (index) => `${formatArea(weights[index])} von ${formatArea(total)}`,
		splitBy: 'days'
	};
}

function consumptionComponent(
	ctx: Context,
	amount: number,
	circleUnits: StatementUnit[],
	key: StatementKey,
	label: string,
	/** The label when § 9a Abs. 2 HeizKV moves the component to the floor area. */
	fallbackLabel: string
): Component {
	const kind = key.meterKind ?? 'heat';
	const usages = circleUnits.map((unit) => usageOf(ctx, unit, kind));
	const usageSplits = circleUnits.map((unit, index) => splitOf(ctx, unit, kind, usages[index]));
	const weights = usages.map((usage) => usage.value);
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	const unitOfMeasure = usages.find((usage) => usage.unit)?.unit ?? '';

	// § 9a Abs. 2 HeizKV: when estimates cover more than a quarter of the area, the cost is split
	// by the fixed-cost key (the floor area) alone.
	const area = (filter: (index: number) => boolean) =>
		circleUnits.reduce((sum, unit, index) => sum + (filter(index) ? (unit.floorArea ?? 0) : 0), 0);
	const estimatedArea = area((index) => usages[index].estimated);
	const totalArea = area(() => true);
	if (totalArea > 0 && estimatedArea / totalArea > ESTIMATED_AREA_LIMIT) {
		warn(ctx, {
			code: 'estimated_share',
			blocking: false,
			href: zaehlerHref(ctx),
			message: `Geschätzte Verbräuche (${meterKindLabels[kind]}) betreffen mehr als 25 % der Fläche; deshalb werden diese Kosten nur nach Fläche verteilt (§ 9a Abs. 2 HeizKV). Prüfe die Zählerstände.`
		});
		return areaComponent(ctx, amount, circleUnits, fallbackLabel);
	}

	return {
		amount,
		label,
		keyTotal: `${formatNumber(total)} ${unitOfMeasure}`.trim(),
		weights,
		unitShare: (index) =>
			`${formatNumber(weights[index])} von ${formatNumber(total)} ${unitOfMeasure}`.trim() +
			(usages[index].estimated ? ' (geschätzt)' : ''),
		splitBy: 'consumption',
		usageSplits
	};
}

function componentsOf(
	ctx: Context,
	item: StatementItem,
	key: StatementKey,
	allocated: number,
	co2LandlordAmount: number,
	circleUnits: StatementUnit[],
	range: DateRange,
	itemDays: number
): Component[] {
	const itemOverlap = daysInclusive(range.start, range.end);
	const occupancy = (unit: StatementUnit) => occupancyIn(ctx, unit, range);
	switch (key.kind) {
		case 'area':
			return [areaComponent(ctx, allocated, circleUnits, '')];
		case 'persons': {
			const weights = circleUnits.map((unit) => {
				const occ = occupancy(unit);
				return occ.leases.reduce((sum, o) => sum + o.personDays, occ.vacancyPersonDays);
			});
			const total = weights.reduce((sum, weight) => sum + weight, 0);
			return [
				{
					amount: allocated,
					label: '',
					keyTotal: `${formatNumber(total)} Personentage`,
					weights,
					unitShare: (index) =>
						`${formatNumber(weights[index])} von ${formatNumber(total)} Personentagen`,
					splitBy: 'persons'
				}
			];
		}
		case 'units':
			return [
				{
					amount: allocated,
					label: '',
					keyTotal: `${circleUnits.length} Einheiten`,
					weights: circleUnits.map(() => 1),
					unitShare: () => `1 von ${circleUnits.length} Einheiten`,
					splitBy: 'days'
				}
			];
		case 'consumption':
			return [
				consumptionComponent(
					ctx,
					allocated,
					circleUnits,
					key,
					'',
					'nach Fläche statt Verbrauch (§ 9a Abs. 2 HeizKV): '
				)
			];
		case 'mixed': {
			const percent = key.consumptionPercent ?? HEIZKV_CONSUMPTION_PERCENT.max;
			const byConsumption = proRata(allocated, percent, 100);
			return [
				consumptionComponent(
					ctx,
					byConsumption,
					circleUnits,
					key,
					`${percent} % nach Verbrauch: `,
					`${percent} % nach Fläche statt Verbrauch (§ 9a Abs. 2 HeizKV): `
				),
				areaComponent(
					ctx,
					allocated - byConsumption,
					circleUnits,
					`${100 - percent} % nach Fläche: `
				)
			];
		}
		case 'custom': {
			const weights = circleUnits.map((unit) => {
				const share = key.shares.find((candidate) => candidate.unitId === unit.id);
				if (!share) {
					warn(ctx, {
						code: 'missing_share',
						blocking: false,
						unitId: unit.id,
						href: '/betriebskosten/schluessel',
						message: `Der Umlageschlüssel „${key.name}“ hat keinen Anteil für die Einheit ${unit.name}.`
					});
				}
				return share?.share ?? 0;
			});
			const total = weights.reduce((sum, weight) => sum + weight, 0);
			return [
				{
					amount: allocated,
					label: '',
					keyTotal: `${formatNumber(total)} Anteile`,
					weights,
					unitShare: (index) =>
						`${formatNumber(weights[index])} von ${formatNumber(total)} Anteilen`,
					splitBy: 'days'
				}
			];
		}
		case 'direct': {
			// The amounts of the Messdienst, prorated like the item (rounded on the running sum, so
			// amounts that add up to the bill still add up to its share of the period); the
			// landlord's CO₂ share is taken off in proportion.
			const entered = circleUnits.map(
				(unit) => item.unitAmounts.find((candidate) => candidate.unitId === unit.id)?.amount ?? 0
			);
			let running = 0;
			const given = entered.map((amount) => {
				const before = proRata(running, itemOverlap, itemDays);
				running += amount;
				return proRata(running, itemOverlap, itemDays) - before;
			});
			// A credit note's amounts are negative: weigh by their size, so the landlord's (negative)
			// share of the CO₂ credit comes off in proportion too.
			const deduction = distributeCents(
				co2LandlordAmount,
				co2LandlordAmount < 0 ? given.map((amount) => -amount) : given
			);
			const direct = given.map((amount, index) => amount - deduction[index]);
			const sum = direct.reduce((total, amount) => total + amount, 0);
			if (running > item.amount) {
				// The tenants would pay more than the bill: for a credit note (negative), they would
				// get less of the credit than the landlord received. Amounts beyond a credit only
				// cost the landlord, like amounts below a bill.
				warn(ctx, {
					code: 'direct_mismatch',
					blocking: true,
					itemId: item.id,
					href: `/betriebskosten/belege/${item.id}`,
					message:
						item.amount < 0
							? `Die Beträge je Einheit der Gutschrift „${item.description}“ ergeben ${formatCents(running)}, die Gutschrift ${formatCents(item.amount)}; die Mieter erhielten weniger als die Gutschrift. Korrigiere die Beträge, bevor du die Abrechnung freigibst.`
							: `Die Beträge je Einheit des Belegs „${item.description}“ ergeben ${formatCents(running)}, mehr als der Beleg über ${formatCents(item.amount)}; korrigiere die Beträge, bevor du die Abrechnung freigibst.`
				});
			} else if (sum !== allocated) {
				warn(ctx, {
					code: 'direct_mismatch',
					blocking: false,
					itemId: item.id,
					href: `/betriebskosten/belege/${item.id}`,
					message: `Die Beträge je Einheit des Belegs „${item.description}“ ergeben ${formatCents(sum)}, der Beleg ${formatCents(allocated)}; die Differenz bleibt beim Vermieter.`
				});
			}
			return [
				{
					amount: sum,
					label: '',
					keyTotal: 'laut Beleg',
					weights: given,
					direct,
					unitShare: () => 'Betrag laut Beleg',
					splitBy: 'days'
				}
			];
		}
	}
}

/** The lease is settled by a Pauschale for this kind of cost; the share stays with the landlord. */
function exclusionReason(lease: StatementLease, heating: boolean): string | undefined {
	if (heating) return lease.heatingCostModel === 'prepayment' ? undefined : 'Heizkostenpauschale';
	if (lease.operatingCostModel === 'prepayment') return undefined;
	return lease.operatingCostModel === 'flat' ? 'Betriebskostenpauschale' : 'Inklusivmiete';
}

function billsAnything(lease: StatementLease): boolean {
	return lease.operatingCostModel === 'prepayment' || lease.heatingCostModel === 'prepayment';
}

type LeaseAccumulator = {
	lease: StatementLease;
	units: StatementUnit[];
	range: DateRange;
	lines: CostLine[];
	excluded: ExcludedLine[];
};

/**
 * How much of each month's `rent` charge the tenant has paid by `asOf`, the way the rent account
 * counts it for the Rückstand: payments and due credits settle the oldest charges first.
 */
function paidRent(lease: StatementLease, asOf: IsoDate): Map<IsoMonth, number> {
	let available = 0;
	for (const payment of lease.payments) if (payment.date <= asOf) available += payment.amount;
	for (const charge of lease.charges) {
		if (charge.amount < 0 && charge.dueDate !== null && charge.dueDate <= asOf) {
			available -= charge.amount;
		}
	}
	// Oldest due first; charges that are not due yet come last.
	const dueKey = (charge: LedgerCharge) => charge.dueDate ?? '9999-12-31';
	const owed = lease.charges
		.filter((charge) => charge.amount > 0)
		.sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || a.period.localeCompare(b.period));
	const paid = new Map<IsoMonth, number>();
	for (const charge of owed) {
		const part = Math.max(0, Math.min(charge.amount, available));
		available -= part;
		if (charge.kind === 'rent') paid.set(charge.period, part);
	}
	return paid;
}

/**
 * Step 5: the prepayments the tenant paid (geleistete Vorauszahlungen), month by month. Once the
 * period is settled the landlord can no longer claim open prepayments on their own; they are part
 * of the Nachzahlung instead, so the statement credits what was paid, not what was charged
 * (decided on 21.10.2026). A payment settles the oldest charges
 * first, and within a month's rent the prepayments before the base rent (§ 366 Abs. 2 BGB: the
 * claim that gives the landlord the least security first). The months before the rent account
 * starts have no charges; their prepayments come from the rent history and count as paid.
 */
function prepaymentsOf(lease: StatementLease, range: DateRange, asOf: IsoDate): PrepaymentMonth[] {
	const rentByMonth = new Map(
		lease.charges
			.filter((charge) => charge.kind === 'rent')
			.map((charge) => [charge.period, charge])
	);
	const paidByMonth = paidRent(lease, asOf);
	const ledgerStart =
		lease.ledgerStart && lease.ledgerStart > lease.startDate ? lease.ledgerStart : lease.startDate;
	return monthsInRange(monthOf(range.start), monthOf(range.end)).map((period) => {
		const charge = rentByMonth.get(period);
		const history = period < monthOf(ledgerStart);
		// A month of the rent account without a charge is not charged yet: nothing to credit.
		const amounts =
			charge ??
			(history
				? monthlyAmounts(
						lease.rentHistory,
						{ startDate: lease.startDate, endDate: lease.endDate },
						period
					)
				: { operatingCostPrepayment: 0, heatingCostPrepayment: 0 });
		// A Pauschale is not a prepayment: it is never settled.
		const operating =
			lease.operatingCostModel === 'prepayment' ? amounts.operatingCostPrepayment : 0;
		const heating = lease.heatingCostModel === 'prepayment' ? amounts.heatingCostPrepayment : 0;
		const charged = operating + heating;
		const paid = history ? charged : Math.min(charged, paidByMonth.get(period) ?? 0);
		const [operatingCostPrepayment, heatingCostPrepayment] = distributeCents(paid, [
			operating,
			heating
		]);
		return {
			period,
			charged,
			operatingCostPrepayment,
			heatingCostPrepayment,
			amount: paid,
			source: history ? 'history' : 'ledger'
		};
	});
}

/**
 * Computes the statement for the property and period: the property result with the totals and
 * warnings, and one LeaseStatement per lease that occupied a unit in the period and pays
 * prepayments. Throws when the period is invalid (the form checks it first).
 */
export function computeStatement(
	input: StatementInput,
	options: StatementOptions = {}
): StatementResult {
	const period = input.period;
	const periodError = validatePeriod(period.start, period.end);
	if (periodError) throw new Error(periodError);
	const today = options.today ?? berlinToday();
	const periodDays = daysInclusive(period.start, period.end);

	const unitById = new Map(input.units.map((unit) => [unit.id, unit]));
	const categoryById = new Map(input.categories.map((category) => [category.id, category]));
	const keyById = new Map(input.keys.map((key) => [key.id, key]));
	const circleById = new Map(input.circles.map((circle) => [circle.id, circle]));
	const metersByUnit = new Map<string, Meter[]>();
	for (const meter of input.meters) {
		if (!meter.unitId) continue;
		const list = metersByUnit.get(meter.unitId);
		if (list) list.push(meter);
		else metersByUnit.set(meter.unitId, [meter]);
	}

	const leases = input.leases
		.filter((lease) => overlap(period, term(lease)))
		.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
	const occupancies = new Map(
		input.units.map((unit) => [
			unit.id,
			occupancyOf(unit, leases, period, input.property.vacancyPersons)
		])
	);
	const ctx: Context = {
		input,
		period,
		today,
		warnings: [],
		leases,
		occupancies,
		rangeOccupancies: new Map(),
		metersByUnit,
		usageCache: new Map(),
		splitCache: new Map()
	};

	for (const occupancy of occupancies.values()) {
		if (occupancy.leases.length === 0) {
			warn(ctx, {
				code: 'no_lease',
				blocking: false,
				unitId: occupancy.unit.id,
				href: `/objekte/${input.property.id}/einheiten/${occupancy.unit.id}`,
				message: `Die Einheit ${occupancy.unit.name} hatte im Zeitraum keinen Mietvertrag; ihr Anteil bleibt als Leerstand beim Vermieter.`
			});
		}
	}

	const accumulators = new Map<string, LeaseAccumulator>();
	for (const lease of leases) {
		const units = lease.unitIds.flatMap((unitId) => unitById.get(unitId) ?? []);
		if (units.length === 0) continue;
		const range = overlap(period, term(lease))!;
		accumulators.set(lease.id, { lease, units, range, lines: [], excluded: [] });
	}

	const items: PropertyItem[] = [];
	let nonAllocableTotal = 0;
	let allocableTotal = 0;
	let landlordCo2Share = 0;
	let vacancyShare = 0;
	let excludedTotal = 0;
	let unallocatedTotal = 0;
	let costsTotal = 0;

	// Step 1, CO₂: the tier follows the building's emissions per m² and year, so the kg of every
	// fuel bill of a circle (or of the property) are added up first, each prorated to the period.
	const circleUnitsOf = (item: StatementItem): StatementUnit[] => {
		const circle = item.billingCircleId ? circleById.get(item.billingCircleId) : undefined;
		return circle ? input.units.filter((unit) => circle.unitIds.includes(unit.id)) : input.units;
	};
	const co2GroupOf = (item: StatementItem): string =>
		item.billingCircleId && circleById.has(item.billingCircleId) ? item.billingCircleId : '';
	const hasCo2 = (item: StatementItem) =>
		Boolean(item.fuel) && item.co2Kg !== null && item.co2Cost !== null;
	const co2KgByGroup = new Map<string, number>();
	for (const item of input.items) {
		const category = categoryById.get(item.categoryId);
		if (!hasCo2(item) || !category || !keyById.has(item.allocationKeyId)) continue;
		if (!item.allocable || !category.allocable) continue;
		const itemOverlap = overlapDays(period, { start: item.periodStart, end: item.periodEnd });
		if (itemOverlap === 0) continue;
		const itemDays = daysInclusive(item.periodStart, item.periodEnd);
		const group = co2GroupOf(item);
		co2KgByGroup.set(
			group,
			(co2KgByGroup.get(group) ?? 0) + (item.co2Kg! * itemOverlap) / itemDays
		);
	}
	// A period shorter than twelve months is scaled to the twelve months from its start.
	const yearDays = daysInclusive(period.start, addDays(addMonths(period.start, 12), -1));
	const annualCo2Kg = (item: StatementItem) =>
		Math.round((((co2KgByGroup.get(co2GroupOf(item)) ?? 0) * yearDays) / periodDays) * 10) / 10;

	for (const item of input.items) {
		const itemOverlap = overlapDays(period, { start: item.periodStart, end: item.periodEnd });
		if (itemOverlap === 0) continue;
		// The part of the period the item covers: its cost is shared by who occupied the units then.
		const range = overlap(period, { start: item.periodStart, end: item.periodEnd })!;
		const itemDays = daysInclusive(item.periodStart, item.periodEnd);
		// Step 1: the cost in the period.
		const total = proRata(item.amount, itemOverlap, itemDays);
		costsTotal += total;
		const category = categoryById.get(item.categoryId);
		const key = keyById.get(item.allocationKeyId);
		const summary: PropertyItem = {
			itemId: item.id,
			description: item.description,
			categoryName: category?.name ?? '',
			keyName: key?.name ?? '',
			keyKind: key?.kind ?? 'units',
			total,
			allocable: item.allocable && (category?.allocable ?? true),
			allocated: 0,
			landlordCo2Share: 0,
			vacancyShare: 0,
			excludedShare: 0,
			unallocated: 0
		};
		items.push(summary);
		if (!summary.allocable) {
			nonAllocableTotal += total;
			continue;
		}
		if (!category) {
			warn(ctx, {
				code: 'unknown_category',
				blocking: true,
				itemId: item.id,
				href: `/betriebskosten/belege/${item.id}`,
				message: `Der Beleg „${item.description}“ hat keine gültige Kostenart.`
			});
			continue;
		}
		if (!key) {
			warn(ctx, {
				code: 'unknown_key',
				blocking: true,
				itemId: item.id,
				href: `/betriebskosten/belege/${item.id}`,
				message: `Der Beleg „${item.description}“ hat keinen gültigen Umlageschlüssel.`
			});
			continue;
		}
		allocableTotal += total;
		const heating = category.consumptionBased;

		if (item.association && item.association.keyTotal > 0) {
			const { total: associationTotal, keyTotal, keyShare, key: keyLabel } = item.association;
			const expected = Math.round((associationTotal * keyShare) / keyTotal);
			if (Math.abs(expected - item.amount) > ASSOCIATION_TOLERANCE) {
				warn(ctx, {
					code: 'association_mismatch',
					blocking: false,
					itemId: item.id,
					href: `/betriebskosten/belege/${item.id}`,
					message: `Beim Beleg „${item.description}“ ergeben ${formatNumber(keyShare)} von ${formatNumber(keyTotal)} ${keyLabel} der Gesamtkosten der WEG (${formatCents(associationTotal)}) ${formatCents(expected)}, eingetragen sind ${formatCents(item.amount)}; prüfe die Werte aus der Hausgeldabrechnung.`
				});
			}
		}

		const circleUnits =
			key.kind === 'direct'
				? input.units.filter((unit) => item.unitAmounts.some((entry) => entry.unitId === unit.id))
				: circleUnitsOf(item);

		// Step 1, CO₂: the landlord's share of the CO₂ cost comes off before anything is allocated.
		let allocated = total;
		let co2: Co2Disclosure | undefined;
		if (item.fuel && item.co2Kg !== null && item.co2Cost !== null) {
			const co2Units = circleUnitsOf(item);
			const area = co2Units.reduce((sum, unit) => sum + (unit.floorArea ?? 0), 0);
			// One unit without its area understates the building's area and so overstates the kg
			// per m²: a higher tier would take too much from the tenants. Parking has no area.
			const missingArea = co2Units.filter(
				(unit) => unit.floorArea === null && unit.kind !== 'parking'
			);
			if (missingArea.length > 0) {
				warn(ctx, {
					code: 'co2_missing_area',
					blocking: true,
					itemId: item.id,
					href:
						missingArea.length === 1
							? `/objekte/${input.property.id}/einheiten/${missingArea[0].id}/bearbeiten`
							: `/objekte/${input.property.id}`,
					message: `Für die CO₂-Kostenaufteilung des Belegs „${item.description}“ fehlt die Wohnfläche der ${missingArea.length === 1 ? 'Einheit' : 'Einheiten'} ${missingArea.map((unit) => unit.name).join(', ')}; ohne sie lässt sich der Anteil des Vermieters nicht bestimmen.`
				});
			} else if (area <= 0) {
				warn(ctx, {
					code: 'co2_missing_area',
					blocking: true,
					itemId: item.id,
					href: `/objekte/${input.property.id}`,
					message: `Für die CO₂-Kostenaufteilung des Belegs „${item.description}“ fehlt die Wohnfläche der Einheiten; ohne sie lässt sich der Anteil des Vermieters nicht bestimmen.`
				});
			}
			const co2Cost = proRata(item.co2Cost, itemOverlap, itemDays);
			const buildingCo2Kg = annualCo2Kg(item);
			const split = splitCo2Cost({
				co2Kg: buildingCo2Kg,
				co2Cost,
				area,
				use: input.property.buildingUse
			});
			co2 = {
				fuel: item.fuel,
				fuelKwh: item.fuelKwh,
				co2Kg: item.co2Kg,
				buildingCo2Kg,
				co2Cost,
				area,
				kgPerSquareMetre: split.kgPerSquareMetre,
				landlordPercent: split.landlordPercent,
				landlordAmount: split.landlordAmount,
				tenantAmount: split.tenantAmount
			};
			allocated -= split.landlordAmount;
			landlordCo2Share += split.landlordAmount;
			summary.landlordCo2Share = split.landlordAmount;
			summary.co2 = co2;
		}

		// Step 6: §§ 7, 8 HeizKV want 50–70 % of heating and hot water cost by consumption.
		if (heating) {
			const consumptionKey =
				key.kind === 'consumption' || key.kind === 'mixed' || key.kind === 'direct';
			const percent = key.consumptionPercent ?? 0;
			const badPercent =
				key.kind === 'mixed' &&
				(percent < HEIZKV_CONSUMPTION_PERCENT.min || percent > HEIZKV_CONSUMPTION_PERCENT.max);
			if (!consumptionKey || badPercent) {
				warn(ctx, {
					code: 'heizkv_key',
					blocking: false,
					itemId: item.id,
					href: '/betriebskosten/schluessel',
					message: `Der Beleg „${item.description}“ (${category.name}) wird nicht zu 50 bis 70 % nach Verbrauch verteilt (§§ 7, 8 HeizKV); die Mieter dürfen ihren Anteil um 15 % kürzen (§ 12 HeizKV).`
				});
			}
		}

		// Steps 2–4: weights per unit, distribution, split over the leases of each unit.
		const components = componentsOf(
			ctx,
			item,
			key,
			allocated,
			co2?.landlordAmount ?? 0,
			circleUnits,
			range,
			itemDays
		);
		summary.allocated = components.reduce((sum, component) => sum + component.amount, 0);
		// What no weight carries: distributeCents gives all zeros when every weight is 0.
		let undistributed = 0;
		const sumOf = (amounts: number[]) => amounts.reduce((sum, amount) => sum + amount, 0);

		// A lease's share texts, each with its unit. A unit that bears nothing over all components
		// (the Stellplatz without area next to the flat) only shows when no unit of the lease bears
		// anything; a unit that bears something keeps every component, its 0 kWh too.
		type LeasePart = {
			amount: number;
			/** `detail` is the split between the unit's leases, e.g. `365 von 365 Tagen`. */
			shares: { unitId: string; text: string; detail: string }[];
			unitAmounts: Map<string, number>;
			method?: SplitMethod;
		};
		const partsByLease = new Map<string, LeasePart>();
		for (const component of components) {
			const unitAmounts = component.direct ?? distributeCents(component.amount, component.weights);
			undistributed += component.amount - sumOf(unitAmounts);
			circleUnits.forEach((unit, unitIndex) => {
				// HeizKV: consumption is recorded and split at a tenant change over the whole period;
				// the shares by time follow the leases within the part of the period the item covers.
				const occupancy =
					component.splitBy === 'consumption'
						? occupancies.get(unit.id)!
						: occupancyIn(ctx, unit, range);
				const unitAmount = unitAmounts[unitIndex];
				let weights: number[];
				let method: SplitMethod | undefined;
				let details: string[] = [];
				if (component.splitBy === 'days') {
					weights = [...occupancy.leases.map((o) => o.days), occupancy.vacancyDays];
					details = occupancy.leases.map((o) => daysText(o, itemOverlap));
				} else if (component.splitBy === 'persons') {
					weights = [...occupancy.leases.map((o) => o.personDays), occupancy.vacancyPersonDays];
					// The detail matters only when the unit's person-days are shared.
					if (occupancy.leases.length > 1 || occupancy.vacancyDays > 0) {
						details = occupancy.leases.map(
							(o) => `davon ${formatNumber(o.personDays)} Personentage`
						);
					}
				} else {
					const split = component.usageSplits![unitIndex];
					weights = split.weights;
					method = split.method;
					details = split.detail;
				}
				const parts = distributeCents(unitAmount, weights);
				undistributed += unitAmount - sumOf(parts);
				occupancy.leases.forEach((occupant, i) => {
					const part: LeasePart = partsByLease.get(occupant.lease.id) ?? {
						amount: 0,
						shares: [],
						unitAmounts: new Map()
					};
					part.amount += parts[i];
					part.unitAmounts.set(unit.id, (part.unitAmounts.get(unit.id) ?? 0) + parts[i]);
					if (method) part.method = method;
					if (parts[i] !== 0 || occupancy.leases.length === 1) {
						const detail = details[i] ?? '';
						const text =
							`${component.label}${component.unitShare(unitIndex)}` +
							(detail ? ` · ${detail}` : '');
						part.shares.push({ unitId: unit.id, text, detail });
					}
					partsByLease.set(occupant.lease.id, part);
				});
				const vacancy = parts[occupancy.leases.length];
				vacancyShare += vacancy;
				summary.vacancyShare += vacancy;
			});
		}
		if (undistributed !== 0) {
			// The cost would vanish from every balance while the item counts as allocated.
			warn(ctx, {
				code: 'no_weight',
				blocking: true,
				itemId: item.id,
				href: `/betriebskosten/belege/${item.id}`,
				message: `Der Beleg „${item.description}“ lässt sich nach dem Umlageschlüssel „${key.name}“ nicht verteilen, weil danach niemand einen Anteil hat (${formatCents(undistributed)}); ergänze die Angaben oder wähle einen anderen Schlüssel, bevor du die Abrechnung freigibst.`
			});
			summary.allocated -= undistributed;
		}
		summary.unallocated = allocated - summary.allocated;
		unallocatedTotal += summary.unallocated;

		// A WEG cost shows how the Verwalter split it first (§ 556a Abs. 3 BGB); within a property
		// of one unit, the key of the property only repeats it, so only the split between leases
		// follows.
		const association = item.association
			? { ...item.association, total: proRata(item.association.total, itemOverlap, itemDays) }
			: undefined;
		const associationText = association
			? `Gesamt ${formatCents(association.total)} · ${association.key} ${formatNumber(association.keyShare)} von ${formatNumber(association.keyTotal)} · Anteil ${formatCents(total)}`
			: '';
		const ownKey = !association || circleUnits.length > 1;
		const shareText = (part: LeasePart) => {
			const bearing = part.shares.filter((share) => part.unitAmounts.get(share.unitId) !== 0);
			const shares = bearing.length > 0 ? bearing : part.shares;
			const texts = ownKey
				? shares.map((share) => share.text)
				: [...new Set(shares.map((share) => share.detail).filter(Boolean))];
			return [associationText, ...texts].filter(Boolean).join(' · ');
		};
		const componentKeyTotal = components.map((c) => `${c.label}${c.keyTotal}`).join(' · ');
		for (const [leaseId, part] of partsByLease) {
			const accumulator = accumulators.get(leaseId);
			if (!accumulator) continue;
			const reason = exclusionReason(accumulator.lease, heating);
			if (reason) {
				accumulator.excluded.push({
					itemId: item.id,
					description: item.description,
					categoryName: category.name,
					amount: part.amount,
					reason
				});
				excludedTotal += part.amount;
				summary.excludedShare += part.amount;
				continue;
			}
			accumulator.lines.push({
				itemId: item.id,
				description: item.description,
				supplier: item.supplier,
				categoryName: category.name,
				betrkvItem: category.betrkvItem,
				keyName: association
					? `${association.key} der WEG${ownKey ? `, dann ${key.name}` : ''}`
					: key.name,
				keyKind: key.kind,
				heating,
				itemTotal: total,
				allocated,
				keyTotal: association
					? [formatNumber(association.keyTotal), ...(ownKey ? [componentKeyTotal] : [])].join(' · ')
					: componentKeyTotal,
				share: shareText(part),
				method: part.method,
				amount: part.amount,
				co2,
				association
			});
		}
	}

	// Step 6: the deadline, for residential leases.
	const deadline = statementDeadline(period.end);
	const residential = [...accumulators.values()].some(
		(accumulator) => accumulator.lease.kind === 'residential' && billsAnything(accumulator.lease)
	);
	const late = residential && today > deadline;
	if (late) {
		warn(ctx, {
			code: 'deadline_passed',
			blocking: false,
			message: `Die Abrechnungsfrist von zwölf Monaten (§ 556 Abs. 3 BGB) ist am ${formatDate(deadline)} abgelaufen; Nachzahlungen von Wohnraummietern sind nur fällig, wenn du die Verspätung nicht zu vertreten hast.`
		});
	}

	// Step 5: per lease.
	const leaseStatements: LeaseStatement[] = [];
	const totals: LeaseTotals[] = [];
	for (const accumulator of accumulators.values()) {
		const { lease, units, range } = accumulator;
		const label = leaseLabel(units, lease.tenants);
		if (!billsAnything(lease)) {
			warn(ctx, {
				code: 'flat_lease',
				blocking: false,
				leaseId: lease.id,
				href: `/vertraege/${lease.id}`,
				message: `Der Mietvertrag ${label} erhält keine Abrechnung (${lease.operatingCostModel === 'flat' ? 'Betriebskostenpauschale' : 'Inklusivmiete'}); seine Anteile bleiben beim Vermieter.`
			});
			continue;
		}
		if (accumulator.excluded.length > 0) {
			warn(ctx, {
				code: 'flat_lease',
				blocking: false,
				leaseId: lease.id,
				href: `/vertraege/${lease.id}`,
				message: `Der Mietvertrag ${label} zahlt eine ${accumulator.excluded[0].reason}; diese Anteile bleiben beim Vermieter.`
			});
		}
		const prepayments = prepaymentsOf(lease, range, today);
		const costsTotal = accumulator.lines.reduce((sum, line) => sum + line.amount, 0);
		const prepaymentsTotal = prepayments.reduce((sum, month) => sum + month.amount, 0);
		const unpaidPrepayments = prepayments.reduce(
			(sum, month) => sum + month.charged - month.amount,
			0
		);
		const balance = costsTotal - prepaymentsTotal;
		const leaseLate = late && lease.kind === 'residential';
		const warnings = ctx.warnings.filter(
			(warning) =>
				warning.leaseId === lease.id ||
				(warning.unitId !== undefined && lease.unitIds.includes(warning.unitId)) ||
				(warning.code === 'deadline_passed' && leaseLate)
		);
		leaseStatements.push({
			leaseId: lease.id,
			leaseKind: lease.kind,
			property: {
				name: input.property.name,
				street: input.property.street,
				postalCode: input.property.postalCode,
				city: input.property.city
			},
			period: { start: period.start, end: period.end, days: periodDays },
			landlord: input.landlord,
			tenants: lease.tenants,
			units: units.map((unit) => ({ id: unit.id, name: unit.name, floorArea: unit.floorArea })),
			occupancy: {
				start: range.start,
				end: range.end,
				days: daysInclusive(range.start, range.end)
			},
			persons: personsPeriods(lease, range),
			lines: accumulator.lines,
			excluded: accumulator.excluded,
			prepayments,
			costsTotal,
			prepaymentsTotal,
			unpaidPrepayments,
			balance,
			deadline,
			late: leaseLate,
			warnings,
			approvedOn: null,
			dueDate: null,
			posted: null
		});
		totals.push({
			leaseId: lease.id,
			label,
			units: units.map((unit) => unit.name).join(' + '),
			tenants: lease.tenants.map(personName).join(', '),
			costsTotal,
			prepaymentsTotal,
			balance
		});
	}

	const property: PropertyResult = {
		propertyId: input.property.id,
		propertyName: input.property.name,
		period: { start: period.start, end: period.end, days: periodDays },
		items,
		costsTotal,
		allocableTotal,
		nonAllocableTotal,
		landlordCo2Share,
		vacancyShare,
		excludedTotal,
		unallocatedTotal,
		leases: totals,
		leaseCount: totals.length,
		nachzahlungen: totals.reduce((sum, lease) => sum + Math.max(lease.balance, 0), 0),
		guthaben: totals.reduce((sum, lease) => sum + Math.max(-lease.balance, 0), 0),
		deadline,
		late,
		warnings: ctx.warnings,
		approvedOn: null
	};
	return { property, leases: leaseStatements };
}
