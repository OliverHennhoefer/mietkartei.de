import { addDays, daysInclusive, isIsoDate, monthOf, monthsInRange, type IsoDate } from '../dates';
import { formatCents, parseCents } from '../money';
import { parseDecimal } from '../format';
import { meterKindLabels } from '../labels';
import type { Fuel, MeterKind } from '../server/db/schema';
import { blocksOf, type Letter, type LetterBlock } from './letters';
import { co2KgFromKwh } from './co2';
import { defaultCategories, defaultKeyNameFor, defaultKeys } from './operating-cost-defaults';
import { monthlyAmounts } from './rents';
import {
	approveLease,
	computeStatement,
	validatePeriod,
	type LeaseStatement,
	type LedgerCharge,
	type PropertyResult,
	type StatementInput,
	type StatementItem,
	type StatementKey,
	type StatementLease,
	type StatementWarning
} from './statement';

// The free statement tool on mietkartei.de/nebenkostenabrechnung/erstellen/: a landlord types
// one house, its flats and tenants and the costs of a year into the browser and gets the same
// letter per tenant that the app prints. Everything stays in the browser; this module turns the
// form's state (numbers kept as typed, so a saved file shows what was entered) into the
// StatementInput of the app's computation and freezes the result as an approval would.

/** The file format of a saved tool state; `version` changes with an incompatible change. */
export const TOOL_FORMAT = 'mietkartei-nebenkostenabrechnung';
export const TOOL_VERSION = 1;

/** The keys the tool offers: those of the app without the WEG shares and fixed shares. */
export const toolKeyKinds = ['area', 'persons', 'units', 'consumption', 'mixed', 'direct'] as const;
export type ToolKeyKind = (typeof toolKeyKinds)[number];

export const toolKeyLabels: Record<ToolKeyKind, string> = {
	area: 'Wohnfläche',
	persons: 'Personen',
	units: 'Wohnungen',
	consumption: 'Verbrauch',
	mixed: 'Verbrauch und Fläche (HeizKV)',
	direct: 'Beträge je Wohnung'
};

/** The meters a consumption key can read. */
export const toolMeterKinds = ['cold_water', 'hot_water', 'heat'] as const;
export type ToolMeterKind = (typeof toolMeterKinds)[number];

export const toolMeterLabels: Record<ToolMeterKind, string> = {
	cold_water: 'Kaltwasser',
	hot_water: 'Warmwasser',
	heat: 'Heizung'
};

export const toolFuels: readonly Fuel[] = ['gas', 'oil', 'lpg', 'district_heating', 'other'];

/** The categories that are heating cost: CO₂ split (CO2KostAufG) and HeizKV apply. */
const heatingItems = new Set([4, 5, 6]);

export type ToolTenancy = {
	id: string;
	salutation: '' | 'Frau' | 'Herr';
	firstName: string;
	lastName: string;
	/** Empty: moved in before the period. */
	start: IsoDate | '';
	/** Empty: still living there at the end of the period. */
	end: IsoDate | '';
	persons: string;
	/** Per month, as typed. */
	operatingCostPrepayment: string;
	heatingCostPrepayment: string;
};

export type ToolUnit = {
	id: string;
	name: string;
	/** m², as typed. */
	area: string;
	/** In order of the move-in; none: the flat stood empty. */
	tenancies: ToolTenancy[];
};

export type ToolCo2 = {
	fuel: Fuel;
	fuelKwh: string;
	co2Kg: string;
	co2Cost: string;
};

export type ToolItem = {
	id: string;
	/** The item of § 2 BetrKV, 1–17. */
	category: number;
	/** Optional, e.g. the supplier; the letter shows it under the category. */
	description: string;
	/** The cost of the period, as typed; empty: not part of the statement. */
	amount: string;
	key: ToolKeyKind;
	/** For a mixed key: the share by consumption, 50–70. */
	consumptionPercent: number;
	/** For a consumption or mixed key. */
	meter: ToolMeterKind;
	/**
	 * For a direct key: the amount per flat (by unit id), or per tenancy (by tenancy id) in a flat
	 * that changed tenants.
	 */
	amounts: Record<string, string>;
	/** Heating with gas, oil or LPG: the CO₂ figures of the supplier invoice. */
	co2: ToolCo2 | null;
};

export type ToolState = {
	periodStart: IsoDate;
	periodEnd: IsoDate;
	landlord: { name: string; street: string; postalCode: string; city: string; iban: string };
	property: { name: string; street: string; postalCode: string; city: string };
	units: ToolUnit[];
	items: ToolItem[];
	/** The consumption of each flat in the period, per meter kind and unit id, as typed. */
	consumption: Record<ToolMeterKind, Record<string, string>>;
	/** Heat meters measure kWh, heat cost allocators unitless Einheiten. */
	heatUnit: 'kWh' | 'Einheiten';
	/** The landlord's own wording of paragraphs of a tenant's letter, by tenancy id. */
	letterEdits: Record<string, ToolLetterEdit[]>;
};

/**
 * A paragraph of a letter as the landlord rewrote it. `original` is the computed text it replaces;
 * when new numbers change that text, the edit no longer applies and is shown for review instead of
 * printing old numbers. An empty `text` leaves the paragraph out.
 */
export type ToolLetterEdit = { original: string; text: string };

let counter = 0;

/** An id unique within the state; random so that two saved files can be merged later. */
export function newId(prefix: string): string {
	counter += 1;
	return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newTenancy(): ToolTenancy {
	return {
		id: newId('m'),
		salutation: '',
		firstName: '',
		lastName: '',
		start: '',
		end: '',
		persons: '1',
		operatingCostPrepayment: '',
		heatingCostPrepayment: ''
	};
}

export function newUnit(index: number): ToolUnit {
	return { id: newId('w'), name: `Wohnung ${index}`, area: '', tenancies: [newTenancy()] };
}

/** The meter a consumption key of the category reads by default. */
function defaultMeter(category: number): ToolMeterKind {
	if (category === 5) return 'hot_water';
	if (category === 4 || category === 6) return 'heat';
	return 'cold_water';
}

/** A cost item of the category with the key the app gives it by default. */
export function newItem(category: number): ToolItem {
	const name = defaultCategories.find((entry) => entry.betrkvItem === category)?.name ?? '';
	const keyName = defaultKeyNameFor(name);
	const key = defaultKeys.find((entry) => entry.name === keyName);
	return {
		id: newId('k'),
		category,
		description: '',
		amount: '',
		// A combined heating and hot water system is split by the meter service (§ 9 HeizKV).
		key: (key?.kind as ToolKeyKind | undefined) ?? 'direct',
		consumptionPercent: key?.consumptionPercent ?? 70,
		meter: (key?.meterKind as ToolMeterKind | null | undefined) ?? defaultMeter(category),
		amounts: {},
		co2: null
	};
}

/** The tool as it opens: last calendar year, one flat, a row for each of the 17 Kostenarten. */
export function newToolState(today: IsoDate): ToolState {
	const year = Number(today.slice(0, 4)) - 1;
	return {
		periodStart: `${year}-01-01`,
		periodEnd: `${year}-12-31`,
		landlord: { name: '', street: '', postalCode: '', city: '', iban: '' },
		property: { name: '', street: '', postalCode: '', city: '' },
		units: [newUnit(1)],
		items: defaultCategories.map((category) => newItem(category.betrkvItem!)),
		consumption: { cold_water: {}, hot_water: {}, heat: {} },
		heatUnit: 'kWh',
		letterEdits: {}
	};
}

export function categoryName(category: number): string {
	return defaultCategories.find((entry) => entry.betrkvItem === category)?.name ?? 'Kostenart';
}

export function isHeating(item: Pick<ToolItem, 'category'>): boolean {
	return heatingItems.has(item.category);
}

/** The items that are part of the statement: those with an amount. */
export function filledItems(state: ToolState): ToolItem[] {
	return state.items.filter((item) => item.amount.trim() !== '');
}

/** The meter kinds the filled items read, in a fixed order. */
export function usedMeters(state: ToolState): ToolMeterKind[] {
	const used = new Set(
		filledItems(state)
			.filter((item) => item.key === 'consumption' || item.key === 'mixed')
			.map((item) => item.meter)
	);
	return toolMeterKinds.filter((kind) => used.has(kind));
}

export function meterUnit(state: ToolState, kind: ToolMeterKind): string {
	return kind === 'heat' ? state.heatUnit : 'm³';
}

/** The rows a direct key asks an amount for: one per flat, one per tenancy after a change. */
export function directRows(state: ToolState): { id: string; label: string; unitId: string }[] {
	return state.units.flatMap((unit) =>
		unit.tenancies.length > 1
			? unit.tenancies.map((tenancy) => ({
					id: tenancy.id,
					label: `${unit.name}, ${tenancyName(tenancy)}`,
					unitId: unit.id
				}))
			: [{ id: unit.id, label: unit.name, unitId: unit.id }]
	);
}

export function tenancyName(tenancy: ToolTenancy): string {
	const name = [tenancy.firstName, tenancy.lastName].filter((part) => part.trim()).join(' ');
	return name || 'Mieter ohne Namen';
}

// Validation and conversion

/** A problem in the entries, shown next to the form; `blocking` ones stop the PDF. */
export type ToolIssue = { message: string; blocking: boolean };

function amountOf(text: string): number | undefined {
	return parseCents(text);
}

function decimalOf(text: string): number | null {
	return parseDecimal(text);
}

/** The tenancy's term in the period's terms: an empty start is the period start. */
function termOf(state: ToolState, tenancy: ToolTenancy): { start: IsoDate; end: IsoDate | null } {
	return { start: tenancy.start || state.periodStart, end: tenancy.end || null };
}

/**
 * What stops the computation (an invalid period or date, an amount that is no amount) and what
 * stops only the PDF (a missing name), in the order of the form.
 */
export function toolIssues(state: ToolState): ToolIssue[] {
	const issues: ToolIssue[] = [];
	const add = (message: string, blocking = true) => issues.push({ message, blocking });
	const periodError = validatePeriod(state.periodStart, state.periodEnd);
	if (periodError) add(periodError);
	if (!state.landlord.name.trim()) add('Trage deinen Namen als Vermieter ein.');
	if (!state.property.street.trim() || !state.property.city.trim())
		add('Trage die Adresse des Hauses ein.');
	if (state.units.length === 0) add('Lege mindestens eine Wohnung an.');
	for (const unit of state.units) {
		const area = decimalOf(unit.area);
		if (unit.area.trim() && (area === null || area < 0))
			add(`${unit.name}: Die Wohnfläche ist keine Zahl.`);
		const terms: { start: IsoDate; end: IsoDate | null; name: string }[] = [];
		for (const tenancy of unit.tenancies) {
			const who = `${unit.name}, ${tenancyName(tenancy)}`;
			if (!tenancy.lastName.trim()) add(`${unit.name}: Trage den Namen des Mieters ein.`);
			if (tenancy.start && !isIsoDate(tenancy.start)) add(`${who}: Das Einzugsdatum fehlt.`);
			if (tenancy.end && !isIsoDate(tenancy.end)) add(`${who}: Das Auszugsdatum fehlt.`);
			const term = termOf(state, tenancy);
			if (term.end && term.end < term.start) add(`${who}: Der Auszug liegt vor dem Einzug.`);
			const persons = decimalOf(tenancy.persons);
			if (persons === null || persons < 0 || !Number.isInteger(persons))
				add(`${who}: Die Personenzahl ist keine ganze Zahl.`);
			for (const [label, text] of [
				['Betriebskosten', tenancy.operatingCostPrepayment],
				['Heizkosten', tenancy.heatingCostPrepayment]
			] as const) {
				const amount = amountOf(text);
				if (text.trim() && (amount === undefined || amount < 0))
					add(`${who}: Die Vorauszahlung für ${label} ist kein Betrag.`);
			}
			for (const other of terms) {
				const overlaps =
					(other.end === null || term.start <= other.end) &&
					(term.end === null || other.start <= term.end);
				if (overlaps)
					add(
						`${unit.name}: ${other.name} und ${tenancyName(tenancy)} wohnen zur gleichen Zeit dort. Trage beim früheren Mieter das Auszugsdatum ein.`
					);
			}
			terms.push({ ...term, name: tenancyName(tenancy) });
		}
	}
	for (const item of filledItems(state)) {
		const name = item.description.trim() || categoryName(item.category);
		if (amountOf(item.amount) === undefined) add(`${name}: Der Betrag ist kein Betrag.`);
		if (item.key === 'direct') {
			for (const row of directRows(state)) {
				const text = item.amounts[row.id] ?? '';
				if (text.trim() && amountOf(text) === undefined)
					add(`${name}: Der Betrag für ${row.label} ist kein Betrag.`);
			}
		}
		if (item.co2) {
			for (const [label, text] of [
				['Die kWh', item.co2.fuelKwh],
				['Die kg CO₂', item.co2.co2Kg]
			] as const) {
				const value = decimalOf(text);
				if (text.trim() && (value === null || value < 0)) add(`${name}: ${label} sind keine Zahl.`);
			}
			if (item.co2.co2Cost.trim() && amountOf(item.co2.co2Cost) === undefined)
				add(`${name}: Die CO₂-Kosten sind kein Betrag.`);
		}
	}
	for (const kind of usedMeters(state)) {
		for (const unit of state.units) {
			const text = state.consumption[kind][unit.id] ?? '';
			const value = decimalOf(text);
			if (text.trim() && (value === null || value < 0))
				add(`${toolMeterLabels[kind]}: Der Verbrauch von ${unit.name} ist keine Zahl.`);
		}
	}
	return issues;
}

/** The issues that make a computation impossible, as opposed to those that only stop the PDF. */
function computable(state: ToolState): boolean {
	return validatePeriod(state.periodStart, state.periodEnd) === undefined;
}

function toolLease(state: ToolState, unit: ToolUnit, tenancy: ToolTenancy): StatementLease {
	const period = { start: state.periodStart, end: state.periodEnd };
	const term = termOf(state, tenancy);
	const operatingCostPrepayment = amountOf(tenancy.operatingCostPrepayment) ?? 0;
	const heatingCostPrepayment = amountOf(tenancy.heatingCostPrepayment) ?? 0;
	const rentHistory = [
		{
			validFrom: term.start,
			baseRent: 0,
			parkingRent: 0,
			operatingCostPrepayment: Math.max(0, operatingCostPrepayment),
			heatingCostPrepayment: Math.max(0, heatingCostPrepayment),
			status: 'approved' as const
		}
	];
	const from = term.start > period.start ? term.start : period.start;
	const to = term.end && term.end < period.end ? term.end : period.end;
	// The prepayments as agreed, counted as paid: the tool has no rent account.
	const charges: LedgerCharge[] =
		from <= to
			? monthsInRange(monthOf(from), monthOf(to)).map((month) => {
					const amounts = monthlyAmounts(
						rentHistory,
						{ startDate: term.start, endDate: term.end },
						month
					);
					return {
						kind: 'rent',
						period: month,
						dueDate: `${month}-03`,
						amount: amounts.operatingCostPrepayment + amounts.heatingCostPrepayment,
						operatingCostPrepayment: amounts.operatingCostPrepayment,
						heatingCostPrepayment: amounts.heatingCostPrepayment
					};
				})
			: [];
	const persons = decimalOf(tenancy.persons);
	return {
		id: tenancy.id,
		kind: 'residential',
		startDate: term.start,
		endDate: term.end,
		operatingCostModel: 'prepayment',
		heatingCostModel: 'prepayment',
		ledgerStart: null,
		unitIds: [unit.id],
		tenants: [
			{
				salutation: tenancy.salutation || null,
				firstName: tenancy.firstName.trim(),
				lastName: tenancy.lastName.trim() || 'Mieter',
				street: null,
				postalCode: null,
				city: null
			}
		],
		persons: [
			{
				validFrom: term.start,
				persons: persons !== null && persons >= 0 ? Math.round(persons) : 0
			}
		],
		rentHistory,
		charges,
		payments: charges.map((charge) => ({ date: charge.dueDate!, amount: charge.amount }))
	};
}

function keyName(item: ToolItem): string {
	if (item.key === 'mixed')
		return `Verbrauch ${item.consumptionPercent}/${100 - item.consumptionPercent}`;
	if (item.key === 'consumption') return `Verbrauch ${toolMeterLabels[item.meter]}`;
	return toolKeyLabels[item.key];
}

/** The tool's state as the input of the app's computation; call only without blocking issues. */
export function toolInput(state: ToolState): StatementInput {
	const period = { start: state.periodStart, end: state.periodEnd };
	const items = filledItems(state);
	const keys: StatementKey[] = items.map((item) => ({
		id: item.id,
		name: keyName(item),
		kind: item.key,
		meterKind:
			item.key === 'consumption' || item.key === 'mixed' ? (item.meter as MeterKind) : null,
		consumptionPercent: item.key === 'mixed' ? item.consumptionPercent : null,
		shares: []
	}));
	const statementItems: StatementItem[] = items.map((item) => {
		const co2 = isHeating(item) && item.co2 ? item.co2 : null;
		const fuelKwh = co2 ? decimalOf(co2.fuelKwh) : null;
		const co2Kg = co2 ? (decimalOf(co2.co2Kg) ?? co2KgFromKwh(co2.fuel, fuelKwh)) : null;
		const co2Cost = co2 ? (amountOf(co2.co2Cost) ?? null) : null;
		const unitAmounts =
			item.key === 'direct'
				? directRows(state).flatMap((row) => {
						const amount = amountOf(item.amounts[row.id] ?? '');
						if (amount === undefined) return [];
						return [
							{
								unitId: row.unitId,
								leaseId: row.id === row.unitId ? null : row.id,
								amount
							}
						];
					})
				: [];
		return {
			id: item.id,
			description: item.description.trim() || categoryName(item.category),
			supplier: null,
			categoryId: `betrkv-${item.category}`,
			allocationKeyId: item.id,
			billingCircleId: null,
			periodStart: period.start,
			periodEnd: period.end,
			amount: amountOf(item.amount) ?? 0,
			allocable: true,
			fuel: co2 ? co2.fuel : null,
			fuelKwh,
			// Without both figures there is nothing to split; the letter then shows no CO₂ part.
			co2Kg: co2Kg !== null && co2Cost !== null ? co2Kg : null,
			co2Cost: co2Kg !== null && co2Cost !== null ? co2Cost : null,
			unitAmounts,
			association: null
		};
	});
	const meters = usedMeters(state).flatMap((kind) =>
		state.units.flatMap((unit) => {
			const value = decimalOf(state.consumption[kind][unit.id] ?? '');
			if (value === null || value < 0) return [];
			// One reading of 0 at the start and the consumption at the end: the tool asks for the
			// consumption, not for meter readings.
			return [
				{
					id: `${kind}-${unit.id}`,
					unitId: unit.id,
					kind: kind as MeterKind,
					unit: meterUnit(state, kind),
					installedAt: null,
					removedAt: null,
					readings: [
						{ readAt: period.start, value: 0, estimated: false },
						{ readAt: period.end, value, estimated: false }
					]
				}
			];
		})
	);
	const street = state.property.street.trim();
	return {
		property: {
			id: 'haus',
			name: state.property.name.trim() || street,
			street,
			postalCode: state.property.postalCode.trim(),
			city: state.property.city.trim(),
			vacancyPersons: 1,
			buildingUse: 'residential'
		},
		period,
		units: state.units.map((unit) => {
			const area = decimalOf(unit.area);
			return {
				id: unit.id,
				name: unit.name.trim() || 'Wohnung',
				kind: 'apartment',
				floorArea: area !== null && area >= 0 ? area : null
			};
		}),
		leases: state.units.flatMap((unit) =>
			unit.tenancies.map((tenancy) => toolLease(state, unit, tenancy))
		),
		items: statementItems,
		categories: defaultCategories.map((category) => ({
			id: `betrkv-${category.betrkvItem}`,
			name: category.name,
			betrkvItem: category.betrkvItem,
			allocable: true,
			consumptionBased: category.consumptionBased
		})),
		keys,
		circles: [],
		meters,
		landlord: {
			name: state.landlord.name.trim(),
			street: state.landlord.street.trim() || null,
			postalCode: state.landlord.postalCode.trim() || null,
			city: state.landlord.city.trim() || null,
			iban: state.landlord.iban.trim() || null,
			bankName: null
		}
	};
}

/** ` (Kaltwasser)` for a message of the app that names the meter kind by its app label. */
function meterOf(message: string): string {
	const kind = toolMeterKinds.find((entry) => message.includes(meterKindLabels[entry]));
	return kind ? ` (${toolMeterLabels[kind]})` : '';
}

/**
 * The warnings of the computation in the tool's words: the app's messages point to its own
 * pages (Zählerstände, Einheiten), the tool asks for the consumption and calls a unit a Wohnung.
 */
function toolWarning(state: ToolState, warning: StatementWarning): StatementWarning {
	const unit = state.units.find((entry) => entry.id === warning.unitId);
	const unitName = unit?.name ?? 'eine Wohnung';
	const rest: StatementWarning = { ...warning };
	delete rest.href;
	switch (warning.code) {
		case 'missing_meter':
		case 'missing_reading':
			return {
				...rest,
				message: `Für ${unitName} fehlt der Verbrauch${meterOf(warning.message)}. Trag ihn bei den Verbräuchen ein, auch wenn er 0 ist.`
			};
		case 'missing_area':
			return {
				...rest,
				message: `Für ${unitName} fehlt die Wohnfläche; ohne sie bekämen die anderen Wohnungen ihren Anteil nach Fläche.`
			};
		case 'no_lease':
			return {
				...rest,
				message: `${unitName} stand im ganzen Zeitraum leer; ihr Anteil bleibt beim Vermieter.`
			};
		default:
			return { ...rest, message: rest.message.replaceAll('Einheit ', 'Wohnung ') };
	}
}

export type ToolResult = {
	issues: ToolIssue[];
	/** Null when the entries cannot be computed yet. */
	statement: {
		property: PropertyResult;
		/** As approved today: what the PDFs print. */
		leases: LeaseStatement[];
		warnings: StatementWarning[];
	} | null;
	/** True when the PDFs can be made: no blocking issue or warning. */
	ready: boolean;
};

/** Computes the statement of the tool's state as approved on `today`. */
export function computeTool(state: ToolState, today: IsoDate): ToolResult {
	const issues = toolIssues(state);
	if (!computable(state)) return { issues, statement: null, ready: false };
	const result = computeStatement(toolInput(state), { today });
	const leases = result.leases.map((lease) =>
		approveLease({ ...lease, warnings: lease.warnings.map((w) => toolWarning(state, w)) }, today)
	);
	const warnings = result.property.warnings.map((warning) => toolWarning(state, warning));
	const blocked =
		issues.some((issue) => issue.blocking) ||
		warnings.some((warning) => warning.blocking) ||
		filledItems(state).length === 0 ||
		leases.length === 0;
	return { issues, statement: { property: result.property, leases, warnings }, ready: !blocked };
}

/** The sum of the filled items, for the form's footer. */
export function itemsTotal(state: ToolState): number {
	return filledItems(state).reduce((sum, item) => sum + (amountOf(item.amount) ?? 0), 0);
}

/** `1234,5` → `1.234,50 €`, empty for what is no amount. */
export function formatTyped(text: string): string {
	const cents = amountOf(text);
	return cents === undefined ? '' : formatCents(cents);
}

// Next year and files

/**
 * The state for the following period: the same house, the tenants still living there with the
 * same prepayments, the same items without amounts and without consumption.
 */
export function nextPeriod(state: ToolState): ToolState {
	const days = daysInclusive(state.periodStart, state.periodEnd);
	const periodStart = addDays(state.periodEnd, 1);
	const shifted = `${Number(periodStart.slice(0, 4)) + 1}${periodStart.slice(4)}`;
	const periodEnd = days >= 365 ? addDays(shifted, -1) : addDays(periodStart, days - 1);
	return {
		...state,
		periodStart,
		periodEnd,
		units: state.units.map((unit) => ({
			...unit,
			tenancies: unit.tenancies
				.filter((tenancy) => !tenancy.end || tenancy.end >= periodStart)
				.map((tenancy) => ({
					...tenancy,
					start: tenancy.start && tenancy.start >= periodStart ? tenancy.start : ''
				}))
		})),
		items: state.items.map((item) => ({
			...item,
			amount: '',
			amounts: {},
			co2: item.co2 ? { ...item.co2, fuelKwh: '', co2Kg: '', co2Cost: '' } : null
		})),
		consumption: { cold_water: {}, hot_water: {}, heat: {} },
		// The new period's letters have new numbers; last year's wording would not fit them.
		letterEdits: {}
	};
}

/** The file a landlord saves: the state with a header naming the format. */
export function toolFile(state: ToolState): string {
	return JSON.stringify({ format: TOOL_FORMAT, version: TOOL_VERSION, ...state }, null, 2);
}

function text(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function stringRecord(value: unknown): Record<string, string> {
	return Object.fromEntries(
		Object.entries(record(value)).map(([key, entry]) => [key, text(entry)])
	);
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
	return options.includes(value as T) ? (value as T) : fallback;
}

/**
 * Reads a saved file (or the browser's draft) back into a state; anything unexpected falls back
 * to an empty field, so a hand-edited file still opens. Undefined when it is no file of the tool.
 */
export function parseToolFile(content: string, today: IsoDate): ToolState | undefined {
	let data: Record<string, unknown>;
	try {
		data = record(JSON.parse(content));
	} catch {
		return undefined;
	}
	if (data.format !== TOOL_FORMAT || data.version !== TOOL_VERSION) return undefined;
	const empty = newToolState(today);
	const landlord = record(data.landlord);
	const property = record(data.property);
	const consumption = record(data.consumption);
	const categories = defaultCategories.map((category) => category.betrkvItem!);
	return {
		periodStart: isIsoDate(text(data.periodStart)) ? text(data.periodStart) : empty.periodStart,
		periodEnd: isIsoDate(text(data.periodEnd)) ? text(data.periodEnd) : empty.periodEnd,
		landlord: {
			name: text(landlord.name),
			street: text(landlord.street),
			postalCode: text(landlord.postalCode),
			city: text(landlord.city),
			iban: text(landlord.iban)
		},
		property: {
			name: text(property.name),
			street: text(property.street),
			postalCode: text(property.postalCode),
			city: text(property.city)
		},
		units: list(data.units).map((entry, index) => {
			const unit = record(entry);
			return {
				id: text(unit.id) || newId('w'),
				name: text(unit.name) || `Wohnung ${index + 1}`,
				area: text(unit.area),
				tenancies: list(unit.tenancies).map((value) => {
					const tenancy = record(value);
					const start = text(tenancy.start);
					const end = text(tenancy.end);
					return {
						id: text(tenancy.id) || newId('m'),
						salutation: oneOf(tenancy.salutation, ['', 'Frau', 'Herr'] as const, ''),
						firstName: text(tenancy.firstName),
						lastName: text(tenancy.lastName),
						start: isIsoDate(start) ? start : '',
						end: isIsoDate(end) ? end : '',
						persons: text(tenancy.persons, '1'),
						operatingCostPrepayment: text(tenancy.operatingCostPrepayment),
						heatingCostPrepayment: text(tenancy.heatingCostPrepayment)
					};
				})
			};
		}),
		items: list(data.items).flatMap((entry) => {
			const item = record(entry);
			const category = Number(item.category);
			if (!categories.includes(category)) return [];
			const co2 = record(item.co2);
			const percent = Number(item.consumptionPercent);
			return [
				{
					id: text(item.id) || newId('k'),
					category,
					description: text(item.description),
					amount: text(item.amount),
					key: oneOf(item.key, toolKeyKinds, 'area'),
					consumptionPercent:
						Number.isInteger(percent) && percent >= 50 && percent <= 70 ? percent : 70,
					meter: oneOf(item.meter, toolMeterKinds, defaultMeter(category)),
					amounts: stringRecord(item.amounts),
					co2:
						item.co2 && typeof item.co2 === 'object'
							? {
									fuel: oneOf(co2.fuel, toolFuels, 'gas'),
									fuelKwh: text(co2.fuelKwh),
									co2Kg: text(co2.co2Kg),
									co2Cost: text(co2.co2Cost)
								}
							: null
				}
			];
		}),
		consumption: {
			cold_water: stringRecord(consumption.cold_water),
			hot_water: stringRecord(consumption.hot_water),
			heat: stringRecord(consumption.heat)
		},
		heatUnit: oneOf(data.heatUnit, ['kWh', 'Einheiten'] as const, 'kWh'),
		letterEdits: Object.fromEntries(
			Object.entries(record(data.letterEdits)).map(([id, edits]) => [
				id,
				list(edits)
					.map((entry) => record(entry))
					.filter((entry) => typeof entry.original === 'string' && typeof entry.text === 'string')
					.map((entry) => ({ original: text(entry.original), text: text(entry.text) }))
			])
		)
	};
}

/** The paragraph blocks of a letter, in order. */
export function letterParagraphs(letter: Letter): string[] {
	return blocksOf(letter).flatMap((block) => ('paragraph' in block ? [block.paragraph] : []));
}

/**
 * The letter with the landlord's wording in place of the computed paragraphs, and the edits whose
 * computed paragraph is no longer in the letter because the numbers changed.
 */
export function applyLetterEdits(
	letter: Letter,
	edits: ToolLetterEdit[] = []
): { letter: Letter; stale: ToolLetterEdit[] } {
	const byOriginal = new Map(edits.map((edit) => [edit.original, edit.text]));
	const used = new Set<string>();
	const blocks = blocksOf(letter).flatMap((block): LetterBlock[] => {
		if (!('paragraph' in block) || !byOriginal.has(block.paragraph)) return [block];
		used.add(block.paragraph);
		const text = byOriginal.get(block.paragraph)!.trim();
		return text ? [{ paragraph: text }] : [];
	});
	return {
		letter: { ...letter, paragraphs: [], blocks },
		stale: edits.filter((edit) => !used.has(edit.original))
	};
}

/** The edits that turn the computed paragraphs into the ones on the sheet. */
export function letterEditsOf(originals: string[], texts: string[]): ToolLetterEdit[] {
	// The sheet turns spaces into non-breaking ones and may add a line break at the end.
	const clean = (text: string) => text.replace(/\u00a0/g, ' ').trim();
	return originals.flatMap((original, index) => {
		const text = clean(texts[index] ?? '');
		return text === clean(original) ? [] : [{ original, text }];
	});
}
