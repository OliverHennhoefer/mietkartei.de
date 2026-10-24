import type { AssociationStatementInput } from '../server/association-statements';
import { FormParser, type ParseResult } from './fields';

// Parses the form of the Hausgeld tab. The property comes from the route, never from the form.
// The Verwalter's result is an amount with its direction, as the Hausgeldabrechnung prints it.

export type AssociationStatementForm = AssociationStatementInput & { balanceKind: string };

export function parseAssociationStatement(form: FormData): ParseResult<AssociationStatementForm> {
	const parser = new FormParser<AssociationStatementForm>(form);
	const periodStart = parser.date('periodStart');
	const periodEnd = parser.date('periodEnd');
	if (periodStart && periodEnd && periodEnd < periodStart) {
		parser.fail('periodEnd', 'Das Ende des Wirtschaftsjahres liegt vor dem Beginn.');
	}
	const allocableCosts = parser.money('allocableCosts', { required: false, min: -100_000_000_00 });
	const nonAllocableCosts = parser.money('nonAllocableCosts', {
		required: false,
		min: -100_000_000_00
	});
	const reserveContribution = parser.money('reserveContribution', { required: false });
	const reserveWithdrawal = parser.money('reserveWithdrawal', { required: false });
	const feesDue = parser.money('feesDue', { required: false });
	const balance = parser.money('statedBalance', { required: false });
	const balanceKind = parser.oneOf('balanceKind', ['due', 'credit'] as const, { required: false });
	const note = parser.optionalText('note', 2000);
	return parser.result(() => ({
		periodStart: periodStart!,
		periodEnd: periodEnd!,
		allocableCosts: allocableCosts ?? 0,
		nonAllocableCosts: nonAllocableCosts ?? 0,
		reserveContribution: reserveContribution ?? 0,
		reserveWithdrawal: reserveWithdrawal ?? 0,
		feesDue: feesDue ?? 0,
		statedBalance: balance === null ? null : balanceKind === 'credit' ? -balance : balance,
		balanceKind: balanceKind ?? 'due',
		note
	}));
}

/** The input without the form's helper field. */
export function associationStatementInput(
	form: AssociationStatementForm
): AssociationStatementInput {
	return {
		periodStart: form.periodStart,
		periodEnd: form.periodEnd,
		allocableCosts: form.allocableCosts,
		nonAllocableCosts: form.nonAllocableCosts,
		reserveContribution: form.reserveContribution,
		reserveWithdrawal: form.reserveWithdrawal,
		feesDue: form.feesDue,
		statedBalance: form.statedBalance,
		note: form.note
	};
}

export const associationStatementMessages = {
	missing: 'Diese Hausgeldabrechnung gibt es nicht.',
	'unknown-property': 'Dieses Objekt gibt es nicht.',
	'duplicate-period': 'Für dieses Wirtschaftsjahr gibt es schon eine Hausgeldabrechnung.'
} as const;
