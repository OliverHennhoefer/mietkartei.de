import type { IsoDate } from '../dates';
import { cappingPercents, type ComparativeDemand } from '../domain/comparative-rent';
import { comparisonSources } from '../server/db/schema';
import type {
	ApprovalInput,
	ConsentInput,
	GraduatedStepInput,
	ManualChangeInput
} from '../server/rent-adjustments';
import { FormParser, type ParseResult } from './fields';

// Parsers of the rent feature: the manual change, a Staffel step, the approval of an index
// proposal, and a § 558 demand with the tenant's consent. Whether the lease allows the change is checked by the server module.

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

/** The corrected delivery date of an approved index change. */
export function parseDelivery(form: FormData): ParseResult<{ deliveredOn: IsoDate }> {
	const parser = new FormParser<{ deliveredOn: IsoDate }>(form);
	const deliveredOn = parser.date('deliveredOn');
	return parser.result(() => ({ deliveredOn: deliveredOn! }));
}

/** A § 558 demand: whether it keeps the rules of § 558 is checked by the server module. */
export function parseComparativeDemand(form: FormData): ParseResult<ComparativeDemand> {
	const parser = new FormParser<ComparativeDemand>(form);
	const deliveredOn = parser.date('deliveredOn');
	const baseRent = parser.money('baseRent', { min: 1 });
	const comparativeRent = parser.money('comparativeRent', { min: 1, max: 1000_00 });
	const capping = parser.oneOf('cappingPercent', cappingPercents.map(String) as ['20', '15']);
	const comparisonSource = parser.oneOf('comparisonSource', comparisonSources);
	const comparisonDetails = parser.text('comparisonDetails', { max: 2000 });
	return parser.result(() => ({
		deliveredOn: deliveredOn!,
		baseRent: baseRent!,
		comparativeRent: comparativeRent!,
		cappingPercent: Number(capping) as ComparativeDemand['cappingPercent'],
		comparisonSource: comparisonSource!,
		comparisonDetails
	}));
}

/** The tenant's consent: the day and the agreed Kaltmiete. */
export function parseConsent(form: FormData): ParseResult<ConsentInput> {
	const parser = new FormParser<ConsentInput>(form);
	const consentedOn = parser.date('consentedOn');
	const baseRent = parser.money('baseRent', { min: 1 });
	return parser.result(() => ({ consentedOn: consentedOn!, baseRent: baseRent! }));
}
