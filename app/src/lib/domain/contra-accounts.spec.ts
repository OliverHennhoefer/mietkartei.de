import { describe, expect, it } from 'vitest';
import { contraAccountFor, splitPayment } from './contra-accounts';

describe('contraAccountFor', () => {
	const accounts = [
		{ id: 'rent-a', kind: 'rent' as const, propertyId: 'a' },
		{ id: 'rent-all', kind: 'rent' as const, propertyId: null },
		{ id: 'nk-b1', kind: 'operating_costs' as const, propertyId: 'b' },
		{ id: 'nk-b2', kind: 'operating_costs' as const, propertyId: 'b' }
	];

	it("takes the property's own account, else the one for no property", () => {
		expect(contraAccountFor(accounts, 'rent', 'a')).toBe('rent-a');
		expect(contraAccountFor(accounts, 'rent', 'b')).toBe('rent-all');
		expect(contraAccountFor(accounts, 'rent', null)).toBe('rent-all');
	});

	it('picks none when the choice is not clear or there is none', () => {
		expect(contraAccountFor(accounts, 'operating_costs', 'b')).toBeUndefined();
		expect(contraAccountFor(accounts, 'operating_costs', 'a')).toBeUndefined();
		expect(contraAccountFor(accounts, 'deposit', 'a')).toBeUndefined();
	});
});

describe('splitPayment', () => {
	const monthly = { amount: 90000, operatingCostPrepayment: 15000, heatingCostPrepayment: 5000 };
	const accounts = { rent: '8005', operating_costs: '8006', statement_balance: '8004' };

	it('splits the full monthly charge exactly into Kaltmiete and Nebenkosten', () => {
		expect(splitPayment(90000, { monthly, statementBalances: [], accounts })).toEqual([
			{ amount: 70000, contraAccountId: '8005' },
			{ amount: 20000, contraAccountId: '8006' }
		]);
	});

	it('splits a partial payment pro rata, in whole cents adding up', () => {
		const parts = splitPayment(45001, { monthly, statementBalances: [], accounts });
		expect(parts).toEqual([
			{ amount: 35001, contraAccountId: '8005' },
			{ amount: 10000, contraAccountId: '8006' }
		]);
	});

	it('books a Nachzahlung or the refund of a Guthaben to Nebenkosten Vorjahr', () => {
		expect(splitPayment(12345, { monthly, statementBalances: [12345], accounts })).toEqual([
			{ amount: 12345, contraAccountId: '8004' }
		]);
		expect(splitPayment(-5000, { monthly, statementBalances: [-5000], accounts })).toEqual([
			{ amount: -5000, contraAccountId: '8004' }
		]);
	});

	it('does not split without a Nebenkosten account, a charge or for a refund', () => {
		expect(
			splitPayment(90000, { monthly, statementBalances: [], accounts: { rent: '8005' } })
		).toEqual([{ amount: 90000, contraAccountId: '8005' }]);
		expect(splitPayment(90000, { monthly: null, statementBalances: [], accounts })).toEqual([
			{ amount: 90000, contraAccountId: '8005' }
		]);
		expect(splitPayment(-100, { monthly, statementBalances: [], accounts })).toEqual([
			{ amount: -100, contraAccountId: '8005' }
		]);
		expect(splitPayment(500, { monthly, statementBalances: [], accounts: {} })).toEqual([
			{ amount: 500, contraAccountId: null }
		]);
	});
});
