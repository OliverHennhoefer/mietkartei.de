import { describe, expect, it } from 'vitest';
import { distributeCents, formatCents, formatCentsSigned, parseCents, proRata } from './money';

describe('formatCents', () => {
	it('formats German currency', () => {
		expect(formatCents(123456)).toBe('1.234,56 €');
		expect(formatCents(-5)).toBe('-0,05 €');
		expect(formatCentsSigned(1200)).toBe('+12,00 €');
		expect(formatCentsSigned(0)).toBe('0,00 €');
	});
});

describe('parseCents', () => {
	it('accepts German and English notations', () => {
		expect(parseCents('1.234,56')).toBe(123456);
		expect(parseCents('1234,56')).toBe(123456);
		expect(parseCents('1234.56')).toBe(123456);
		expect(parseCents('1,234.56')).toBe(123456);
		expect(parseCents('1.234.567')).toBe(123456700);
		expect(parseCents('1234')).toBe(123400);
		expect(parseCents(' 12,5 € ')).toBe(1250);
		expect(parseCents('-12,50')).toBe(-1250);
		expect(parseCents('0')).toBe(0);
	});

	it('rejects garbage', () => {
		expect(parseCents('')).toBeUndefined();
		expect(parseCents('abc')).toBeUndefined();
		expect(parseCents('1,2,3')).toBeUndefined();
		expect(parseCents('12,345')).toBeUndefined();
		expect(parseCents('--1')).toBeUndefined();
	});
});

describe('distributeCents', () => {
	it('keeps the sum exact and is deterministic', () => {
		expect(distributeCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
		expect(distributeCents(1000, [72.5, 64, 48])).toEqual([393, 347, 260]);
		expect(distributeCents(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
		expect(distributeCents(7, [0, 0, 0])).toEqual([0, 0, 0]);
		expect(distributeCents(7, [0, 3, 0])).toEqual([0, 7, 0]);
		expect(distributeCents(0, [1, 2])).toEqual([0, 0]);
	});

	it('matches a hand-computed area split', () => {
		// 2.000,00 € over 72,5 m², 64 m², 48 m² (184,5 m²): 785,91 / 693,77 / 520,33 → sum 2.000,01,
		// so the largest fraction (520,325… no, 693,766… ) loses the cent.
		const parts = distributeCents(200000, [72.5, 64, 48]);
		expect(parts.reduce((a, b) => a + b)).toBe(200000);
		expect(parts).toEqual([78591, 69377, 52032]);
	});
});

describe('proRata', () => {
	it('rounds half up', () => {
		expect(proRata(10000, 15, 31)).toBe(4839);
		expect(proRata(1, 1, 2)).toBe(1);
		expect(proRata(100, 0, 0)).toBe(0);
	});

	it('rounds a negative half away from zero, so a credit cancels its positive twin', () => {
		// −1,01 € × 1/2 = −50,5 ct → −51 ct, as +1,01 € gives +51 ct.
		expect(proRata(-101, 1, 2)).toBe(-51);
		expect(proRata(101, 1, 2)).toBe(51);
		// −10,00 € × 15/31 = −483,87… ct → −484 ct.
		expect(proRata(-10000, 15, 31)).toBe(-4839);
		// −0,4 ct rounds to 0, not to −0.
		expect(proRata(-1, 2, 5)).toBe(0);
	});
});
