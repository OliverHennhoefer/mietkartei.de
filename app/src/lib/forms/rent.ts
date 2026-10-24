import type {
	ApprovalInput,
	GraduatedStepInput,
	ManualChangeInput
} from '../server/rent-adjustments';
import { FormParser, type ParseResult } from './fields';

// Parsers of the rent feature: the manual change, a Staffel step and the approval of an index
// proposal. Whether the lease allows the change is checked by the server module.

export type ManualChangeOptions = {
	/**
	 * The base rent valid on the change's first day, to tell a change of the Kaltmiete from one of
	 * the prepayments (undefined before the lease starts).
	 */
	baseRentOn: (validFrom: string) => number | undefined;
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
		validFrom !== null &&
		baseRent !== options.baseRentOn(validFrom) &&
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
