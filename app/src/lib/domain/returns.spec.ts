import { describe, expect, it } from 'vitest';
import { returns, type ReturnsInput } from './returns';

// Haus: bought for 400.000 € with a loan of 300.000 €, one lease at 1.000 € Kaltmiete plus
// 200 € utilities. Hof: no Anschaffungskosten. 2026, a calendar year.

const year = { start: '2026-01-01', end: '2026-12-31' };

function input(overrides: Partial<ReturnsInput> = {}): ReturnsInput {
	const months = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
	return {
		properties: [
			{ id: 'haus', name: 'Haus', acquisitionCost: 400_000_00, loanAmount: 300_000_00 },
			{ id: 'hof', name: 'Hof', acquisitionCost: null, loanAmount: null }
		],
		units: [
			{ id: 'eg', propertyId: 'haus' },
			{ id: 'hof1', propertyId: 'hof' }
		],
		leases: [
			{ id: 'l-eg', unitId: 'eg' },
			{ id: 'l-hof', unitId: 'hof1' }
		],
		charges: [
			...months.map((month) => ({ leaseId: 'l-eg', period: `2026-${month}`, baseRent: 1000_00 })),
			{ leaseId: 'l-eg', period: '2025-12', baseRent: 1000_00 },
			{ leaseId: 'l-hof', period: '2026-01', baseRent: 100_00 }
		],
		payments: [
			...months.map((month) => ({ leaseId: 'l-eg', date: `2026-${month}-03`, amount: 1200_00 })),
			{ leaseId: 'l-hof', date: '2026-01-03', amount: 100_00 }
		],
		expenses: [
			// The utilities passed on, and 600 € the landlord keeps.
			{ date: '2026-03-01', amount: 2400_00, category: 'operating_costs', propertyId: 'haus' },
			{ date: '2026-05-01', amount: 600_00, category: 'maintenance', propertyId: 'haus' },
			// Twelve rates of 1.000 €, 6.000 € interest in the year.
			...months.map((month) => ({
				date: `2026-${month}-15`,
				amount: 1000_00,
				category: 'loan_payment' as const,
				propertyId: 'haus'
			})),
			{ date: '2026-06-01', amount: 500_00, category: 'management', propertyId: null }
		],
		interest: [{ propertyId: 'haus', year: 2026, amount: 6000_00 }],
		...overrides
	};
}

describe('returns', () => {
	it('splits the Darlehensraten with the interest of their year', () => {
		const [haus] = returns(input(), { range: year, propertyId: null }).properties;
		expect(haus).toMatchObject({
			baseRent: 12000_00,
			received: 14400_00,
			operating: 3000_00,
			interest: 6000_00,
			repayment: 6000_00,
			unsplit: 0,
			cashflow: 14400_00 - 3000_00 - 12000_00,
			ownCapital: 100_000_00
		});
		expect(haus.gross).toBeCloseTo(0.03);
		expect(haus.net).toBeCloseTo(11400 / 400000);
		expect(haus.equity).toBeCloseTo(5400 / 100000);
	});

	it('gives a window its share of the interest and annualises the rates', () => {
		const half = returns(input(), {
			range: { start: '2026-01-01', end: '2026-06-30' },
			propertyId: 'haus'
		});
		expect(half.months).toBe(6);
		expect(half.properties[0]).toMatchObject({ interest: 3000_00, repayment: 3000_00 });
		expect(half.properties[0].gross).toBeCloseTo(0.03);
	});

	it('leaves the rate unsplit and the return on equity open without the interest', () => {
		const [haus] = returns(input({ interest: [] }), { range: year, propertyId: null }).properties;
		expect(haus).toMatchObject({ interest: 0, repayment: 0, unsplit: 12000_00 });
		expect(haus.equity).toBeNull();
		expect(haus.gross).toBeCloseTo(0.03);
	});

	it('counts the portfolio-wide expenses in the cashflow, the rates only over properties with costs', () => {
		const result = returns(input(), { range: year, propertyId: null });
		expect(result.totals.received).toBe(14500_00);
		expect(result.totals.operating).toBe(3500_00);
		expect(result.totals.cashflow).toBe(14500_00 - 3500_00 - 12000_00);
		expect(result.rates).toMatchObject({ counted: 1, acquisitionCost: 400_000_00 });
		expect(result.rates.gross).toBeCloseTo(0.03);
		expect(result.properties[1]).toMatchObject({ gross: null, net: null, equity: null });
	});

	it('estimates the interest of a year without Zinsbescheinigung from the year before', () => {
		const data = input();
		const [haus] = returns(
			{
				...data,
				interest: [{ propertyId: 'haus', year: 2025, amount: 6000_00 }],
				expenses: [
					...data.expenses,
					...Array.from({ length: 12 }, (_, index) => ({
						date: `2025-${String(index + 1).padStart(2, '0')}-15`,
						amount: 1000_00,
						category: 'loan_payment' as const,
						propertyId: 'haus'
					}))
				]
			},
			{ range: year, propertyId: null }
		).properties;
		expect(haus).toMatchObject({
			interest: 6000_00,
			estimatedInterest: 6000_00,
			repayment: 6000_00,
			unsplit: 0
		});
		expect(haus.equity).toBeCloseTo(5400 / 100000);
	});

	it('gives no return on equity without the loan', () => {
		const data = input();
		const result = returns(
			{ ...data, properties: [{ ...data.properties[0], loanAmount: null }] },
			{ range: year, propertyId: null }
		);
		expect(result.properties[0].equity).toBeNull();
		expect(result.rates.ownCapital).toBeNull();
		expect(result.rates.equity).toBeNull();
	});
});
