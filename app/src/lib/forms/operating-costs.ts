import { allocationKeyKinds, meterKinds } from '../server/db/schema';
import type { CostCategoryInput } from '../server/operating-costs/categories';
import type { BillingCircleInput } from '../server/operating-costs/circles';
import type { AllocationKeyInput, KeyShare } from '../server/operating-costs/keys';
import { FormParser, type ParseResult } from './fields';

// Parsers of the operating costs setup forms. Whether the ids belong to the account is checked
// by the server module; the parsers only check shape and the rules a form can check on its own
// (the HeizKV range of a mixed key, at least one unit in a circle).

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
	'unknown-property': 'Dieses Objekt gibt es nicht.'
} as const;

export function keyErrorField(reason: keyof typeof keyMessages): keyof AllocationKeyInput {
	return reason === 'unknown-property' ? 'propertyId' : 'name';
}
