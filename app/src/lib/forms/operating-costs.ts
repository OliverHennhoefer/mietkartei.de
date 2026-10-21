import { CIRCLE_FROM_CATEGORY } from '../domain/operating-costs';
import { allocationKeyKinds, meterKinds } from '../server/db/schema';
import type { CostCategoryInput } from '../server/operating-costs/categories';
import type { BillingCircleInput } from '../server/operating-costs/circles';
import type { CostItemInput, UnitAmount } from '../server/operating-costs/cost-items';
import type { AllocationKeyInput, KeyShare } from '../server/operating-costs/keys';
import type { MeterInput, ReadingInput } from '../server/operating-costs/meters';
import { FormParser, type ParseResult } from './fields';

// Parsers of the operating costs setup forms. Whether the ids belong to the account is checked
// by the server module; the parsers only check shape and the rules a form can check on its own
// (the HeizKV range of a mixed key, period order, at least one unit in a circle).

export function parseCategory(form: FormData): ParseResult<CostCategoryInput> {
	const parser = new FormParser<CostCategoryInput>(form);
	const name = parser.text('name', { max: 100 });
	const betrkvItem = parser.number('betrkvItem', {
		required: false,
		integer: true,
		min: 1,
		max: 17
	});
	const allocable = parser.flag('allocable');
	const consumptionBased = parser.flag('consumptionBased');
	const allocationKeyId = parser.id('allocationKeyId', { required: false });
	const billingCircleId = parser.id('billingCircleId', { required: false });
	const sortOrder =
		parser.number('sortOrder', { required: false, integer: true, min: 0, max: 1000 }) ?? 0;
	return parser.result(() => ({
		name,
		betrkvItem,
		allocable,
		consumptionBased,
		allocationKeyId,
		billingCircleId,
		sortOrder
	}));
}

/** Meter kinds whose mixed key must split 50–70 % by consumption (§§ 7, 8 HeizKV). */
const heizkvMeterKinds: readonly string[] = ['heat', 'hot_water'];

export function parseKey(form: FormData): ParseResult<AllocationKeyInput> {
	const parser = new FormParser<AllocationKeyInput>(form);
	const name = parser.text('name', { max: 100 });
	const kind = parser.oneOf('kind', allocationKeyKinds);
	const propertyId = parser.id('propertyId', { required: false });
	const byMeter = kind === 'consumption' || kind === 'mixed';
	const meterKind = parser.oneOf('meterKind', meterKinds, { required: byMeter });
	const consumptionPercent = parser.number('consumptionPercent', {
		required: kind === 'mixed',
		integer: true,
		min: 0,
		max: 100
	});
	if (
		kind === 'mixed' &&
		meterKind &&
		heizkvMeterKinds.includes(meterKind) &&
		consumptionPercent !== null &&
		(consumptionPercent < 50 || consumptionPercent > 70)
	) {
		parser.fail(
			'consumptionPercent',
			'Heiz- und Warmwasserkosten werden zu 50 bis 70 % nach Verbrauch verteilt (§§ 7, 8 HeizKV).'
		);
	}
	if (kind === 'custom' && !propertyId) {
		parser.fail('propertyId', 'Eigene Anteile gelten für ein Objekt; bitte wähle eines aus.');
	}
	return parser.result(() => ({
		name,
		kind: kind!,
		propertyId,
		meterKind: byMeter ? meterKind : null,
		consumptionPercent: kind === 'mixed' ? consumptionPercent : null
	}));
}

/** The result of a form with one input per unit: errors are keyed by the input name. */
export type PerUnitResult<T> =
	| { ok: true; data: T }
	| { ok: false; errors: Record<string, string>; values: Record<string, string> };

function perUnit<T>(parser: FormParser<Record<string, number>>, data: T): PerUnitResult<T> {
	if (parser.hasErrors) {
		return { ok: false, errors: parser.errors as Record<string, string>, values: parser.values };
	}
	return { ok: true, data };
}

/** Every string field of the form, for re-rendering it after a refusal of the server module. */
export function formValues(form: FormData): Record<string, string> {
	const values: Record<string, string> = {};
	for (const [name, value] of form.entries()) {
		if (typeof value === 'string') values[name] = value.trim();
	}
	return values;
}

/** One input `share-<unitId>` per unit of the property; empty means no share. */
export function parseKeyShares(
	form: FormData,
	unitIds: readonly string[]
): PerUnitResult<{ shares: KeyShare[] }> {
	const parser = new FormParser<Record<string, number>>(form);
	const shares: KeyShare[] = [];
	for (const unitId of unitIds) {
		const share = parser.number(`share-${unitId}`, { required: false, min: 0 });
		if (share !== null && share > 0) shares.push({ unitId, share });
	}
	return perUnit(parser, { shares });
}

export function parseCircle(form: FormData): ParseResult<BillingCircleInput> {
	const parser = new FormParser<BillingCircleInput>(form);
	const name = parser.text('name', { max: 100 });
	const unitIds = parser.ids('unitIds');
	if (unitIds.length === 0) parser.fail('unitIds', 'Bitte wähle mindestens eine Einheit aus.');
	return parser.result(() => ({ name, unitIds }));
}

export function parseMeter(form: FormData): ParseResult<MeterInput> {
	const parser = new FormParser<MeterInput>(form);
	// The empty option is the building itself.
	const unitId = parser.id('unitId', { required: false });
	const kind = parser.oneOf('kind', meterKinds);
	const serialNumber = parser.optionalText('serialNumber', 100);
	const unit = parser.text('unit', { max: 20 });
	const location = parser.optionalText('location', 200);
	const installedAt = parser.date('installedAt', { required: false });
	return parser.result(() => ({
		unitId,
		kind: kind!,
		serialNumber,
		unit,
		location,
		installedAt
	}));
}

export function parseReading(form: FormData): ParseResult<ReadingInput> {
	const parser = new FormParser<ReadingInput>(form);
	const readAt = parser.date('readAt');
	const value = parser.number('value', { min: 0, max: 1_000_000_000 });
	const estimated = parser.flag('estimated');
	const note = parser.optionalText('note', 200);
	return parser.result(() => ({ readAt: readAt!, value: value!, estimated, note }));
}

export function parseRemoval(form: FormData): ParseResult<{ removedAt: string }> {
	const parser = new FormParser<{ removedAt: string }>(form);
	const removedAt = parser.date('removedAt');
	return parser.result(() => ({ removedAt: removedAt! }));
}

/** The cost item form; the key and circle may be left to the category (see applyCategoryDefaults). */
export type CostItemForm = Omit<CostItemInput, 'allocationKeyId' | 'billingCircleId'> & {
	/** Null: the default key of the category. */
	allocationKeyId: string | null;
	/** Null: all units of the property, unless `circleFromCategory`. */
	billingCircleId: string | null;
	/** The circle select was left on "Standard der Kostenart". */
	circleFromCategory: boolean;
	receipt: File | null;
};

export function parseCostItem(form: FormData): ParseResult<CostItemForm> {
	const parser = new FormParser<CostItemForm>(form);
	const propertyId = parser.id('propertyId');
	const categoryId = parser.id('categoryId');
	const allocationKeyId = parser.id('allocationKeyId', { required: false });
	const circleRaw = parser.raw('billingCircleId');
	const circleFromCategory = circleRaw === CIRCLE_FROM_CATEGORY;
	const billingCircleId = circleFromCategory || !circleRaw ? null : circleRaw;
	if (billingCircleId && billingCircleId.length > 64)
		parser.fail('billingCircleId', 'Ungültige Auswahl.');
	const description = parser.text('description', { max: 200 });
	const supplier = parser.optionalText('supplier', 200);
	const invoiceDate = parser.date('invoiceDate', { required: false });
	const periodStart = parser.date('periodStart');
	const periodEnd = parser.date('periodEnd');
	if (periodStart && periodEnd && periodEnd < periodStart) {
		parser.fail('periodEnd', 'Das Ende des Zeitraums liegt vor dem Beginn.');
	}
	// Credit notes are negative amounts.
	const amount = parser.money('amount', { min: -100_000_000_00 });
	const allocable = parser.flag('allocable');
	const receipt = parser.file('receipt');
	return parser.result(() => ({
		propertyId: propertyId!,
		categoryId: categoryId!,
		allocationKeyId,
		billingCircleId,
		circleFromCategory,
		description,
		supplier,
		invoiceDate,
		periodStart: periodStart!,
		periodEnd: periodEnd!,
		amount: amount!,
		allocable,
		receipt
	}));
}

/** One input `amount-<unitId>` per unit; empty means 0. */
export function parseUnitAmounts(
	form: FormData,
	unitIds: readonly string[]
): PerUnitResult<{ amounts: UnitAmount[] }> {
	const parser = new FormParser<Record<string, number>>(form);
	const amounts: UnitAmount[] = [];
	for (const unitId of unitIds) {
		const amount = parser.money(`amount-${unitId}`, { required: false, min: -100_000_000_00 });
		if (amount !== null && amount !== 0) amounts.push({ unitId, amount });
	}
	return perUnit(parser, { amounts });
}

export function parseReceipt(form: FormData): ParseResult<{ receipt: File }> {
	const parser = new FormParser<{ receipt: File }>(form);
	const receipt = parser.file('receipt', { required: true });
	return parser.result(() => ({ receipt: receipt! }));
}

// The German sentences for the refusals of the server module, and the field each belongs to.

export const categoryMessages = {
	missing: 'Diese Kostenart gibt es nicht.',
	'duplicate-name': 'Eine Kostenart mit diesem Namen gibt es schon.',
	'unknown-key': 'Diesen Umlageschlüssel gibt es nicht.',
	'unknown-circle': 'Diesen Abrechnungskreis gibt es nicht.'
} as const;

export function categoryErrorField(reason: keyof typeof categoryMessages): keyof CostCategoryInput {
	if (reason === 'unknown-key') return 'allocationKeyId';
	if (reason === 'unknown-circle') return 'billingCircleId';
	return 'name';
}

export const keyMessages = {
	missing: 'Diesen Umlageschlüssel gibt es nicht.',
	'duplicate-name': 'Einen Umlageschlüssel mit diesem Namen gibt es schon.',
	'unknown-property': 'Dieses Objekt gibt es nicht.',
	'property-in-use':
		'Der Umlageschlüssel wird von Belegen verwendet; sein Objekt kann nicht geändert werden. Ordne den Belegen zuerst einen anderen Schlüssel zu.',
	'kind-in-use':
		'Der Umlageschlüssel wird von Belegen verwendet; er kann nicht zu Beträgen je Einheit oder davon weg wechseln. Ordne den Belegen zuerst einen anderen Schlüssel zu.'
} as const;

export function keyErrorField(reason: keyof typeof keyMessages): keyof AllocationKeyInput {
	switch (reason) {
		case 'unknown-property':
		case 'property-in-use':
			return 'propertyId';
		case 'kind-in-use':
			return 'kind';
		default:
			return 'name';
	}
}

export const costItemMessages = {
	missing: 'Diesen Beleg gibt es nicht.',
	'unknown-property': 'Dieses Objekt gibt es nicht.',
	'unknown-category': 'Diese Kostenart gibt es nicht.',
	'unknown-key': 'Dieser Umlageschlüssel gilt nicht für das gewählte Objekt.',
	'unknown-circle': 'Dieser Abrechnungskreis gehört nicht zum gewählten Objekt.',
	'no-key': 'Die Kostenart hat keinen Standard-Umlageschlüssel; bitte wähle einen aus.'
} as const;

export function costItemErrorField(reason: keyof typeof costItemMessages): keyof CostItemForm {
	switch (reason) {
		case 'unknown-property':
			return 'propertyId';
		case 'unknown-category':
			return 'categoryId';
		case 'unknown-key':
		case 'no-key':
			return 'allocationKeyId';
		case 'unknown-circle':
			return 'billingCircleId';
		default:
			return 'description';
	}
}
