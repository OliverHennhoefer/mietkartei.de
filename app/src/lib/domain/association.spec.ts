import { describe, expect, it } from 'vitest';
import { balanceText, reconcileAssociation, type AssociationFigures } from './association';

// Wirtschaftsjahr 2025 of a flat with 85 of 1.000 MEA: 1.800 € allocable, 600 € not allocable,
// 400 € Zuführung zur Rücklage, 12 × 250 € = 3.000 € Hausgeld due.
const figures: AssociationFigures = {
	periodStart: '2025-01-01',
	periodEnd: '2025-12-31',
	allocableCosts: 180000,
	nonAllocableCosts: 60000,
	reserveContribution: 40000,
	feesDue: 300000,
	statedBalance: -20000
};

const plain = (text: string) => text.replace(/\u00a0/g, ' ');

describe('reconcileAssociation', () => {
	it('finds nothing when the figures, the payments and the Belege agree', () => {
		const result = reconcileAssociation(figures, 300000, [
			{ periodStart: '2025-01-01', periodEnd: '2025-12-31', amount: 120000, allocable: true },
			{ periodStart: '2025-01-01', periodEnd: '2025-12-31', amount: 60000, allocable: true }
		]);
		expect(result).toEqual({
			costsTotal: 280000,
			computedBalance: -20000,
			balanceDifference: 0,
			feesPaid: 300000,
			feesOutstanding: 0,
			settlement: -20000,
			allocableRecorded: 180000,
			allocableMissing: 0,
			findings: []
		});
	});

	it('names a stated balance that does not follow from the figures', () => {
		const result = reconcileAssociation({ ...figures, statedBalance: 10000 }, 300000, []);
		expect(result.balanceDifference).toBe(30000);
		const finding = result.findings.find((entry) => entry.code === 'balance')!;
		expect(plain(finding.message)).toContain('Nachzahlung 100,00 €');
		expect(plain(finding.message)).toContain('Guthaben 200,00 €');
	});

	it('names Hausgeld not paid and Hausgeld paid in excess', () => {
		const short = reconcileAssociation(figures, 275000, []);
		expect(short.feesOutstanding).toBe(25000);
		expect(short.settlement).toBe(5000);
		expect(plain(short.findings.find((entry) => entry.code === 'fees')!.message)).toContain(
			'es fehlen 250,00 €'
		);
		const excess = reconcileAssociation(figures, 350000, []);
		expect(plain(excess.findings.find((entry) => entry.code === 'fees')!.message)).toContain(
			'500,00 € mehr'
		);
	});

	it('counts the allocable Belege prorated to the period and names what is missing', () => {
		const result = reconcileAssociation(figures, 300000, [
			// Half of it falls into 2025.
			{ periodStart: '2025-07-01', periodEnd: '2026-06-30', amount: 73000, allocable: true },
			{ periodStart: '2025-01-01', periodEnd: '2025-12-31', amount: 50000, allocable: false }
		]);
		expect(result.allocableRecorded).toBe(36800);
		expect(result.allocableMissing).toBe(143200);
		expect(plain(result.findings.find((entry) => entry.code === 'allocable')!.message)).toContain(
			'1.432,00 € fehlen'
		);
	});

	it('takes a cent of rounding as agreement', () => {
		const result = reconcileAssociation({ ...figures, statedBalance: -20050 }, 299950, [
			{ periodStart: '2025-01-01', periodEnd: '2025-12-31', amount: 180080, allocable: true }
		]);
		expect(result.findings).toEqual([]);
	});
});

describe('balanceText', () => {
	it('names the direction', () => {
		expect(plain(balanceText(12000))).toBe('Nachzahlung 120,00 €');
		expect(plain(balanceText(-8000))).toBe('Guthaben 80,00 €');
		expect(balanceText(0)).toBe('ausgeglichen');
	});
});
