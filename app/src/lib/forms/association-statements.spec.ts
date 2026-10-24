import { describe, expect, it } from 'vitest';
import { associationStatementInput, parseAssociationStatement } from './association-statements';
import { formDataOf } from './fields';

const fields = {
	periodStart: '2025-01-01',
	periodEnd: '2025-12-31',
	allocableCosts: '1.800,00',
	nonAllocableCosts: '600',
	reserveContribution: '400,00',
	feesDue: '3.000,00',
	statedBalance: '200,00',
	balanceKind: 'credit',
	note: ''
};

describe('parseAssociationStatement', () => {
	it('reads the amounts and turns a Guthaben negative', () => {
		const result = parseAssociationStatement(formDataOf(fields));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(associationStatementInput(result.data)).toEqual({
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			allocableCosts: 180000,
			nonAllocableCosts: 60000,
			reserveContribution: 40000,
			feesDue: 300000,
			statedBalance: -20000,
			note: null
		});
	});

	it('takes empty amounts as 0 and no result as not stated', () => {
		const result = parseAssociationStatement(
			formDataOf({ periodStart: '2025-01-01', periodEnd: '2025-12-31', balanceKind: 'due' })
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toMatchObject({
			allocableCosts: 0,
			nonAllocableCosts: 0,
			reserveContribution: 0,
			feesDue: 0,
			statedBalance: null
		});
	});

	it('refuses a period that ends before it starts', () => {
		const result = parseAssociationStatement(formDataOf({ ...fields, periodEnd: '2024-12-31' }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(Object.keys(result.errors)).toEqual(['periodEnd']);
	});
});
