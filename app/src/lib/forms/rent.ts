import type {
	ApprovalInput,
	GraduatedStepInput,
	IndexValueInput,
	ManualChangeInput
} from '../server/rent-adjustments';
import { FormParser, type ParseResult } from './fields';

// Parsers of the rent feature: the manual change, a Staffel step, the approval of an index
// proposal and a VPI value. Whether the lease allows the change is checked by the server module.

export type ManualChangeOptions = {
	/** The base rent valid today, to tell a change of the Kaltmiete from one of the prepayments. */
	currentBaseRent: number;
	/** Residential graduated or indexed lease: § 557a/§ 557b exclude § 558, so a change needs a reason. */
	noteRequiredOnBaseRentChange: boolean;
};

export function parseManualChange(
	form: FormData,
	options: ManualChangeOptions
): ParseResult<ManualChangeInput> {
	const parser = new FormParser<ManualChangeInput>(form);
	const validFrom = parser.date('validFrom');
	const baseRent = parser.money('baseRent');
	const operatingCostPrepayment = parser.money('operatingCostPrepayment', { required: false }) ?? 0;
	const heatingCostPrepayment = parser.money('heatingCostPrepayment', { required: false }) ?? 0;
	const reason = parser.oneOf('reason', ['manual', 'statement'] as const);
	const note = parser.optionalText('note', 1000);
	if (
		options.noteRequiredOnBaseRentChange &&
		baseRent !== null &&
		baseRent !== options.currentBaseRent &&
		!note
	) {
		parser.fail(
			'note',
			'Bitte begründe die Änderung der Kaltmiete in der Notiz (§ 557a Abs. 2 / § 557b Abs. 2 BGB).'
		);
	}
	return parser.result(() => ({
		validFrom: validFrom!,
		baseRent: baseRent!,
		operatingCostPrepayment,
		heatingCostPrepayment,
		reason: reason!,
		note
	}));
}

export function parseGraduatedStep(form: FormData): ParseResult<GraduatedStepInput> {
	const parser = new FormParser<GraduatedStepInput>(form);
	const validFrom = parser.date('validFrom');
	const baseRent = parser.money('baseRent');
	return parser.result(() => ({ validFrom: validFrom!, baseRent: baseRent! }));
}

/** The approval form: the delivery date, and the effective date when the lease may choose it. */
export function parseApproval(
	form: FormData,
	options: { editableValidFrom: boolean }
): ParseResult<ApprovalInput> {
	const parser = new FormParser<ApprovalInput>(form);
	const deliveredOn = parser.date('deliveredOn');
	const validFrom = options.editableValidFrom ? parser.date('validFrom') : null;
	if (deliveredOn && validFrom && validFrom <= deliveredOn) {
		parser.fail('validFrom', 'Die neue Miete kann erst nach der Zustellung gelten.');
	}
	return parser.result(() => ({ deliveredOn: deliveredOn!, validFrom }));
}

/** A VPI value: month, value with at most one decimal, base year (four digits, default 2020). */
export function parseIndexValue(form: FormData): ParseResult<IndexValueInput> {
	const parser = new FormParser<IndexValueInput>(form);
	const month = parser.month('month');
	const raw = parser.raw('value');
	let value: number | null = null;
	if (!raw) parser.fail('value', 'Bitte gib den Indexwert an.');
	else if (!/^\d{1,4}([.,]\d)?$/.test(raw)) {
		parser.fail(
			'value',
			'Bitte gib den Indexwert mit höchstens einer Nachkommastelle an, z. B. 121,4.'
		);
	} else {
		value = Number(raw.replace(',', '.'));
		if (value <= 0) parser.fail('value', 'Der Indexwert muss größer als 0 sein.');
	}
	const baseYear = parser.raw('baseYear') || '2020';
	if (!/^(19|20)\d{2}$/.test(baseYear)) {
		parser.fail('baseYear', 'Bitte gib das Basisjahr mit vier Ziffern an, z. B. 2020.');
	}
	return parser.result(() => ({ month: month!, value: value!, baseYear }));
}
