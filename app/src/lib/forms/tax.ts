import type { DepreciationInput } from '../server/tax';
import { FormParser, type ParseResult } from './fields';

// Parses the two forms of the Steuer tab: the AfA basis of the property and the interest of a
// year from the bank's Zinsbescheinigung. The property comes from the route, never from the form.

/** The AfA basis: all four fields, or none (removes it). */
export function parseDepreciation(form: FormData): ParseResult<DepreciationInput> {
	const parser = new FormParser<DepreciationInput>(form);
	const acquisitionDate = parser.date('acquisitionDate', { required: false });
	const acquisitionCost = parser.money('acquisitionCost', { required: false });
	const buildingShare = parser.number('buildingShare', { required: false, min: 0, max: 100 });
	const depreciationRate = parser.number('depreciationRate', { required: false, min: 0, max: 100 });
	const values = { acquisitionDate, acquisitionCost, buildingShare, depreciationRate };
	const given = Object.values(values).filter((value) => value !== null).length;
	if (given > 0 && given < 4) {
		for (const [name, value] of Object.entries(values)) {
			if (value === null) {
				parser.fail(name as keyof DepreciationInput, 'Für die AfA braucht es alle vier Angaben.');
			}
		}
	}
	return parser.result(() => values);
}

export type LoanInterestForm = { year: number; loanInterest: number | null };

/** The interest of a year; empty removes it. */
export function parseLoanInterest(form: FormData): ParseResult<LoanInterestForm> {
	const parser = new FormParser<LoanInterestForm>(form);
	const year = parser.number('year', { min: 1900, max: 2100, integer: true });
	const loanInterest = parser.money('loanInterest', { required: false });
	return parser.result(() => ({ year: year!, loanInterest }));
}
