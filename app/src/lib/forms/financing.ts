import type { FinancingInput } from '../server/returns';
import { FormParser, type ParseResult } from './fields';

// Parses the form of Rendite und Cashflow for one property: its Anschaffungskosten and the
// Darlehenssumme. Either may stay empty; the property id says which one.

export type FinancingForm = FinancingInput & { propertyId: string };

export function parseFinancing(form: FormData): ParseResult<FinancingForm> {
	const parser = new FormParser<FinancingForm>(form);
	const propertyId = parser.id('propertyId');
	const acquisitionCost = parser.money('acquisitionCost', { required: false });
	const loanAmount = parser.money('loanAmount', { required: false });
	return parser.result(() => ({ propertyId: propertyId!, acquisitionCost, loanAmount }));
}
