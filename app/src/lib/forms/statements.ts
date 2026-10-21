import { validatePeriod } from '../domain/statement';
import { FormParser, type ParseResult } from './fields';

// Parsers of the statement forms: the new draft, the approval and the delivery date.

export type NewStatementInput = { propertyId: string; periodStart: string; periodEnd: string };

export function parseNewStatement(form: FormData): ParseResult<NewStatementInput> {
	const parser = new FormParser<NewStatementInput>(form);
	const propertyId = parser.id('propertyId');
	const periodStart = parser.date('periodStart');
	const periodEnd = parser.date('periodEnd');
	if (periodStart && periodEnd) {
		const periodError = validatePeriod(periodStart, periodEnd);
		if (periodError) parser.fail('periodEnd', periodError);
	}
	return parser.result(() => ({
		propertyId: propertyId!,
		periodStart: periodStart!,
		periodEnd: periodEnd!
	}));
}

export type ApprovalFormInput = { lateApprovalJustified: boolean; note: string | null };

/** The approval: the "Verspätung nicht zu vertreten" checkbox needs a note. */
export function parseApproval(form: FormData): ParseResult<ApprovalFormInput> {
	const parser = new FormParser<ApprovalFormInput>(form);
	const lateApprovalJustified = parser.flag('lateApprovalJustified');
	const note = parser.optionalText('note', 500);
	if (lateApprovalJustified && !note) {
		parser.fail('note', 'Bitte begründe, warum du die Verspätung nicht zu vertreten hast.');
	}
	return parser.result(() => ({ lateApprovalJustified, note }));
}

export type DeliveredInput = { leaseId: string; deliveredOn: string };

export function parseDelivered(form: FormData): ParseResult<DeliveredInput> {
	const parser = new FormParser<DeliveredInput>(form);
	const leaseId = parser.id('leaseId');
	const deliveredOn = parser.date('deliveredOn');
	return parser.result(() => ({ leaseId: leaseId!, deliveredOn: deliveredOn! }));
}
