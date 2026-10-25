import { describe, expect, it } from 'vitest';
import { formatCents } from '../money';
import {
	depreciationFor,
	taxOverview,
	type TaxCharge,
	type TaxExpense,
	type TaxInput,
	type TaxProperty
} from './tax';

const property: TaxProperty = {
	kind: 'building',
	acquisitionDate: '2020-04-15',
	acquisitionCost: 400_000_00,
	buildingShare: 75,
	depreciationRate: 2
};

/** Twelve months of 600 € Kaltmiete and 200 € prepayments for the lease. */
function rents(leaseId: string, year = 2025): TaxCharge[] {
	return Array.from({ length: 12 }, (_, index) => ({
		leaseId,
		period: `${year}-${String(index + 1).padStart(2, '0')}`,
		dueDate: `${year}-${String(index + 1).padStart(2, '0')}-03`,
		kind: 'rent' as const,
		baseRent: 600_00,
		operatingCostPrepayment: 150_00,
		heatingCostPrepayment: 50_00,
		amount: 800_00
	}));
}

let expenseId = 0;
function expense(date: string, amount: number, category: TaxExpense['category']): TaxExpense {
	expenseId += 1;
	return { id: `e${expenseId}`, date, amount, category, description: category };
}

function input(overrides: Partial<TaxInput> = {}): TaxInput {
	return {
		year: 2025,
		property,
		units: [
			{ id: 'flat', kind: 'apartment' },
			{ id: 'shop', kind: 'commercial' },
			{ id: 'garage', kind: 'parking' }
		],
		leases: [{ id: 'l1', unitId: 'flat' }],
		charges: rents('l1'),
		payments: Array.from({ length: 12 }, (_, index) => ({
			leaseId: 'l1',
			date: `2025-${String(index + 1).padStart(2, '0')}-03`,
			amount: 800_00
		})),
		expenses: [],
		associationStatements: [],
		loanInterest: null,
		...overrides
	};
}

const line = (overview: ReturnType<typeof taxOverview>, key: string) =>
	[...overview.income, ...overview.costs].find((row) => row.key === key);

describe('depreciationFor', () => {
	it('starts with the month of acquisition and stops at the building value', () => {
		// 300.000 € building, 6.000 € a year; 2020 from April = 9 months.
		expect(depreciationFor(property, 2020)).toEqual({
			base: 300_000_00,
			yearly: 6_000_00,
			months: 9,
			amount: 4_500_00,
			remaining: 295_500_00
		});
		expect(depreciationFor(property, 2025)).toMatchObject({ months: 12, amount: 6_000_00 });
		expect(depreciationFor(property, 2019)).toMatchObject({ amount: 0, remaining: 300_000_00 });
		const fast = { ...property, depreciationRate: 50 };
		expect(depreciationFor(fast, 2021)).toMatchObject({ amount: 150_000_00 });
		expect(depreciationFor(fast, 2022)).toMatchObject({ amount: 37_500_00, remaining: 0 });
		expect(depreciationFor(fast, 2023)).toMatchObject({ amount: 0, remaining: 0 });
	});

	it('needs all four figures', () => {
		expect(depreciationFor({ ...property, buildingShare: null }, 2025)).toBeNull();
	});
});

describe('taxOverview', () => {
	it('splits the rent received into Kaltmiete and Umlagen by the kind of unit', () => {
		const overview = taxOverview(
			input({
				leases: [
					{ id: 'l1', unitId: 'flat' },
					{ id: 'l2', unitId: 'shop' },
					{ id: 'l3', unitId: 'garage' }
				],
				charges: [
					...rents('l1'),
					{ ...rents('l2')[0], period: '2025-03' },
					{ ...rents('l3')[0], baseRent: 50_00, amount: 50_00, period: '2025-05' },
					{ ...rents('l1')[0], period: '2024-12' }
				],
				payments: [
					...input().payments,
					{ leaseId: 'l2', date: '2025-03-02', amount: 800_00 },
					{ leaseId: 'l3', date: '2025-05-02', amount: 50_00 },
					{ leaseId: 'l3', date: '2024-12-30', amount: 50_00 }
				]
			})
		);
		expect(line(overview, 'apartments')).toMatchObject({ line: 15, amount: 7_200_00 });
		expect(line(overview, 'otherRooms')).toMatchObject({ line: 18, amount: 600_00 });
		expect(line(overview, 'parking')).toMatchObject({ line: 26, amount: 50_00 });
		expect(line(overview, 'prepayments')).toMatchObject({ line: 20, amount: 2_600_00 });
		expect(overview.incomeTotal).toBe(10_450_00);
		expect(overview.leases.every((lease) => !lease.prorated)).toBe(true);
	});

	it('counts statement results as Umlagen and manual charges as other income', () => {
		const overview = taxOverview(
			input({
				charges: [
					...rents('l1'),
					{ ...rents('l1')[0], kind: 'statement_balance', baseRent: 0, amount: 120_00 },
					{ ...rents('l1')[0], kind: 'co2_reimbursement', baseRent: 0, amount: -20_00 },
					{ ...rents('l1')[0], kind: 'adjustment', baseRent: 0, amount: 5_00 }
				],
				payments: [...input().payments, { leaseId: 'l1', date: '2025-07-01', amount: 105_00 }]
			})
		);
		expect(line(overview, 'settlements')).toMatchObject({ line: 21, amount: 100_00 });
		expect(line(overview, 'otherIncome')).toMatchObject({ line: 29, amount: 5_00 });
	});

	it('counts a statement result in the year it falls due, not in its period', () => {
		const lastYear = {
			...rents('l1')[0],
			period: '2024-12',
			kind: 'statement_balance' as const,
			baseRent: 0,
			amount: 300_00
		};
		const charges = [
			...rents('l1'),
			{ ...lastYear, dueDate: '2025-02-15' },
			{ ...lastYear, dueDate: null, amount: 999_00 }
		];
		const payments = [...input().payments, { leaseId: 'l1', date: '2025-02-10', amount: 300_00 }];
		const overview = taxOverview(input({ charges, payments }));
		expect(line(overview, 'settlements')?.amount).toBe(300_00);
		expect(line(overview, 'apartments')?.amount).toBe(7_200_00);
		expect(overview.leases[0].prorated).toBe(false);
	});

	it('splits payments that differ from the charges proportionally and says so', () => {
		const short = taxOverview(input({ payments: input().payments.slice(0, 9) }));
		// 9 of 12 months paid: 7.200 € × 3/4 Kaltmiete, 2.400 € × 3/4 Umlagen.
		expect(line(short, 'apartments')?.amount).toBe(5_400_00);
		expect(line(short, 'prepayments')?.amount).toBe(1_800_00);
		expect(short.leases[0]).toMatchObject({
			received: 7_200_00,
			charged: 9_600_00,
			prorated: true
		});
		expect(short.findings.map((finding) => finding.code)).toContain('prorated');

		const backRent = taxOverview(
			input({ charges: [], payments: [{ leaseId: 'l1', date: '2025-01-05', amount: 800_00 }] })
		);
		expect(line(backRent, 'apartments')?.amount).toBe(800_00);
		const refund = taxOverview(
			input({ charges: [], payments: [{ leaseId: 'l1', date: '2025-01-05', amount: -90_00 }] })
		);
		expect(line(refund, 'settlements')?.amount).toBe(-90_00);
		expect(taxOverview(input({ charges: [], payments: [] })).leases).toEqual([]);
	});

	it('sorts the expenses into the lines and keeps what is not deductible apart', () => {
		const overview = taxOverview(
			input({
				expenses: [
					expense('2025-02-01', 1_000_00, 'operating_costs'),
					expense('2025-03-01', 2_000_00, 'maintenance'),
					expense('2025-03-02', 500_00, 'special_levy'),
					expense('2025-03-03', 300_00, 'special_levy_reserve'),
					expense('2025-04-01', 400_00, 'management'),
					expense('2025-05-01', 100_00, 'other'),
					expense('2025-06-01', 9_000_00, 'modernization'),
					expense('2025-06-02', 700_00, 'loan_interest'),
					expense('2025-06-03', 1_300_00, 'loan_repayment'),
					expense('2024-06-01', 5_000_00, 'maintenance')
				]
			})
		);
		expect(line(overview, 'depreciation')).toMatchObject({
			line: 33,
			amount: 6_000_00,
			entries: [{ label: `2 % von ${formatCents(300_000_00)}` }]
		});
		expect(line(overview, 'interest')?.amount).toBe(700_00);
		expect(line(overview, 'maintenance')?.amount).toBe(2_500_00);
		expect(line(overview, 'allocatedCosts')?.amount).toBe(1_000_00);
		expect(line(overview, 'unallocatedCosts')?.amount).toBe(400_00);
		expect(line(overview, 'otherCosts')?.amount).toBe(100_00);
		expect(overview.costsTotal).toBe(10_700_00);
		expect(overview.result).toBe(9_600_00 - 10_700_00);
		expect(overview.nonDeductible.map((item) => [item.label, item.amount])).toEqual([
			['Tilgung', 1_300_00],
			['Sonderumlagen in die Rücklage', 300_00],
			['Modernisierung und Anschaffungen', 9_000_00]
		]);
		expect(overview.findings).toEqual([]);
	});

	it('takes the interest of loan payments from the Zinsbescheinigung', () => {
		const payments = [expense('2025-01-15', 6_000_00, 'loan_payment')];
		const without = taxOverview(input({ expenses: payments }));
		expect(line(without, 'interest')).toBeUndefined();
		expect(without.nonDeductible).toMatchObject([{ label: 'Darlehensraten', amount: 6_000_00 }]);
		expect(without.findings.map((finding) => finding.code)).toEqual(['interest-missing']);

		const withInterest = taxOverview(input({ expenses: payments, loanInterest: 2_400_00 }));
		expect(line(withInterest, 'interest')?.amount).toBe(2_400_00);
		expect(withInterest.nonDeductible).toMatchObject([
			{ label: 'Tilgung in den Darlehensraten', amount: 3_600_00 }
		]);
		expect(withInterest.findings).toEqual([]);
		expect(line(taxOverview(input({ loanInterest: 100_00 })), 'interest')?.amount).toBe(100_00);
	});

	it('deducts Hausgeld without the Zuführung and adds the Entnahme from the reserve', () => {
		const condominium = { ...property, kind: 'condominium' as const };
		const fees = Array.from({ length: 12 }, (_, index) =>
			expense(`2025-${String(index + 1).padStart(2, '0')}-01`, 250_00, 'association_fee')
		);
		const overview = taxOverview(
			input({
				property: condominium,
				expenses: fees,
				associationStatements: [
					{
						periodStart: '2025-01-01',
						allocableCosts: 1_800_00,
						nonAllocableCosts: 600_00,
						reserveContribution: 400_00,
						reserveWithdrawal: 150_00
					},
					{
						periodStart: '2024-01-01',
						allocableCosts: 0,
						nonAllocableCosts: 0,
						reserveContribution: 9_999_00,
						reserveWithdrawal: 0
					}
				]
			})
		);
		// 3.000 € paid less 400 € Zuführung = 2.600 €, 3/4 allocable.
		expect(line(overview, 'allocatedCosts')?.amount).toBe(1_950_00);
		expect(line(overview, 'unallocatedCosts')?.amount).toBe(650_00);
		expect(line(overview, 'maintenance')?.entries).toEqual([
			{ label: 'Entnahme aus der Erhaltungsrücklage', amount: 150_00 }
		]);
		expect(overview.nonDeductible).toMatchObject([
			{ label: 'Zuführung zur Erhaltungsrücklage', amount: 400_00 }
		]);

		// Two short Wirtschaftsjahre add up; without payments no Zuführung is excluded.
		const half = {
			allocableCosts: 900_00,
			nonAllocableCosts: 300_00,
			reserveContribution: 200_00,
			reserveWithdrawal: 50_00
		};
		const split = taxOverview(
			input({
				property: condominium,
				expenses: fees,
				associationStatements: [
					{ ...half, periodStart: '2025-01-01' },
					{ ...half, periodStart: '2025-07-01' }
				]
			})
		);
		expect(line(split, 'allocatedCosts')?.amount).toBe(1_950_00);
		expect(line(split, 'maintenance')?.amount).toBe(100_00);
		const unpaid = taxOverview(
			input({
				property: condominium,
				associationStatements: [{ ...half, periodStart: '2025-01-01' }]
			})
		);
		expect(line(unpaid, 'allocatedCosts')).toBeUndefined();
		expect(line(unpaid, 'unallocatedCosts')).toBeUndefined();
		expect(unpaid.nonDeductible).toEqual([]);

		const missing = taxOverview(input({ property: condominium, expenses: fees }));
		expect(line(missing, 'unallocatedCosts')?.amount).toBe(3_000_00);
		expect(missing.findings.map((finding) => finding.code)).toEqual(['association-missing']);
	});

	it('warns about a missing AfA basis and about anschaffungsnahe Herstellungskosten', () => {
		const noBasis = taxOverview(input({ property: { ...property, acquisitionCost: null } }));
		expect(line(noBasis, 'depreciation')).toBeUndefined();
		expect(noBasis.depreciation).toBeNull();
		expect(noBasis.findings.map((finding) => finding.code)).toEqual(['depreciation-missing']);

		// 15 % of the 300.000 € building is 45.000 €; within three years of 15 April 2020.
		const works = [
			expense('2021-05-01', 30_000_00, 'maintenance'),
			expense('2022-05-01', 16_000_00, 'modernization'),
			expense('2023-04-15', 50_000_00, 'maintenance')
		];
		expect(
			taxOverview(input({ year: 2022, expenses: works })).findings.map((finding) => finding.code)
		).toContain('acquisition-related');
		expect(
			taxOverview(input({ year: 2024, expenses: works })).findings.map((finding) => finding.code)
		).not.toContain('acquisition-related');
		expect(
			taxOverview(input({ year: 2022, expenses: works.slice(0, 1) })).findings
		).not.toContainEqual(expect.objectContaining({ code: 'acquisition-related' }));
	});

	it('shows the months of a partial first year with the AfA', () => {
		const overview = taxOverview(input({ year: 2020, charges: [], payments: [] }));
		expect(line(overview, 'depreciation')?.entries[0].label).toBe(
			`2 % von ${formatCents(300_000_00)}, 9 Monate`
		);
	});
});
