import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import {
	addDays,
	addMonths,
	daysBetween,
	daysInclusive,
	formatDate,
	overlapDays,
	parseGermanDate,
	type IsoDate
} from './dates';
import { distributeCents, formatCentsPlain, parseCents, proRata } from './money';

// Property-based tests: fast-check generates many inputs per property and shrinks a failure to
// the smallest input that breaks it. They cover the arithmetic that every rent account and
// statement relies on, beyond the hand-picked cases in the other spec files.

const cents = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });
const isoDate = fc
	.date({
		min: new Date('1990-01-01T00:00:00Z'),
		max: new Date('2099-12-31T00:00:00Z'),
		noInvalidDate: true
	})
	.map((date) => date.toISOString().slice(0, 10) as IsoDate);
const range = fc
	.tuple(isoDate, isoDate)
	.map(([a, b]) => (a <= b ? { start: a, end: b } : { start: b, end: a }));

describe('money properties', () => {
	it('parses every amount it formats back to the same cents', () => {
		fc.assert(
			fc.property(cents, (amount) => {
				expect(parseCents(formatCentsPlain(amount))).toBe(amount);
				expect(parseCents(`${formatCentsPlain(amount)} €`)).toBe(amount);
			})
		);
	});

	it('splits a total into parts that add up to it and differ from the exact share by under a cent', () => {
		fc.assert(
			fc.property(
				cents,
				fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 30 }),
				(total, weights) => {
					const parts = distributeCents(total, weights);
					const sum = weights.reduce((acc, weight) => acc + weight, 0);
					expect(parts).toHaveLength(weights.length);
					// Never -0, which would print as "-0,00 €".
					expect(parts.some((part) => Object.is(part, -0))).toBe(false);
					if (sum === 0) {
						expect(parts.every((part) => part === 0)).toBe(true);
						return;
					}
					expect(parts.reduce((acc, part) => acc + part, 0)).toBe(total);
					parts.forEach((part, index) => {
						expect(Math.abs(part - (total * weights[index]) / sum)).toBeLessThan(1);
						if (weights[index] === 0) expect(part).toBe(0);
					});
				}
			)
		);
	});

	it('prorates a credit to the negative of its charge and the whole to itself', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 100_000_000 }),
				fc.integer({ min: 0, max: 366 }),
				fc.integer({ min: 1, max: 366 }),
				(amount, numerator, denominator) => {
					expect(proRata(-amount, numerator, denominator)).toBe(
						-proRata(amount, numerator, denominator) || 0
					);
					expect(proRata(amount, denominator, denominator)).toBe(amount);
				}
			)
		);
	});
});

describe('date properties', () => {
	it('counts the days it adds and reads the dates it prints', () => {
		fc.assert(
			fc.property(isoDate, fc.integer({ min: -20_000, max: 20_000 }), (date, days) => {
				expect(daysBetween(date, addDays(date, days))).toBe(days);
				expect(parseGermanDate(formatDate(date))).toBe(date);
			})
		);
	});

	it('never leaves the target month when adding months', () => {
		fc.assert(
			fc.property(isoDate, fc.integer({ min: -600, max: 600 }), (date, months) => {
				const result = addMonths(date, months);
				const [year, month] = date.split('-').map(Number);
				const total = year * 12 + month - 1 + months;
				expect(result.slice(0, 7)).toBe(
					`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
				);
				expect(Number(result.slice(8))).toBeLessThanOrEqual(Number(date.slice(8)));
			})
		);
	});

	it('finds an overlap that is symmetric and no longer than either range', () => {
		fc.assert(
			fc.property(range, range, (a, b) => {
				const days = overlapDays(a, b);
				expect(overlapDays(b, a)).toBe(days);
				expect(days).toBeLessThanOrEqual(daysInclusive(a.start, a.end));
				expect(days).toBeLessThanOrEqual(daysInclusive(b.start, b.end));
				expect(overlapDays(a, a)).toBe(daysInclusive(a.start, a.end));
			})
		);
	});
});

describe('csv properties', () => {
	it('reads back any table written with quoted cells', () => {
		const cell = fc.string({ unit: fc.constantFrom('a', 'Ä', ' ', ';', ',', '"', '\n', '1') });
		fc.assert(
			fc.property(
				fc.array(fc.array(cell, { minLength: 2, maxLength: 4 }), { minLength: 1, maxLength: 5 }),
				(rows) => {
					const width = rows[0].length;
					const table = rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''));
					const text = table
						.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(';'))
						.join('\r\n');
					expect(parseCsv(text, { delimiter: ';' })).toEqual(table);
				}
			)
		);
	});
});
