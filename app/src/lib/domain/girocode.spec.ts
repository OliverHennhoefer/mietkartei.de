import { describe, expect, it } from 'vitest';
import { giroCode, giroCodeModules, ibanNamedIn, paymentPurpose } from './girocode';

const input = {
	name: 'Erika Vermieter',
	iban: 'de02 1203 0000 0000 2020 51',
	amount: 10599,
	purpose: 'Nachzahlung Betriebskostenabrechnung 2025, Wohnung 3, Müller'
};

describe('giroCode', () => {
	it('writes the EPC payload of a SEPA credit transfer, version 002 without BIC', () => {
		expect(giroCode(input)).toEqual({
			payload: [
				'BCD',
				'002',
				'1',
				'SCT',
				'',
				'Erika Vermieter',
				'DE02120300000000202051',
				'EUR105.99',
				'',
				'',
				'Nachzahlung Betriebskostenabrechnung 2025, Wohnung 3, Müller'
			].join('\n'),
			lines: [
				'Empfänger: Erika Vermieter',
				'IBAN: DE02 1203 0000 0000 2020 51',
				'Betrag: 105,99 €',
				'Verwendungszweck: Nachzahlung Betriebskostenabrechnung 2025, Wohnung 3, Müller'
			]
		});
	});

	it('writes amounts in whole cents', () => {
		const amount = (cents: number) => giroCode({ ...input, amount: cents })!.payload.split('\n')[7];
		expect(amount(1)).toBe('EUR0.01');
		expect(amount(120000)).toBe('EUR1200.00');
		expect(amount(99_999_999_999)).toBe('EUR999999999.99');
	});

	it('cuts name and Verwendungszweck to the lengths of the standard, on one line each', () => {
		const code = giroCode({
			...input,
			name: `Erika\n${'x'.repeat(100)}`,
			purpose: `Zeile eins\nZeile zwei ${'y'.repeat(200)}`
		})!;
		const lines = code.payload.split('\n');
		expect(lines).toHaveLength(11);
		expect(lines[5]).toHaveLength(70);
		expect(lines[5]).toMatch(/^Erika x+$/);
		expect(lines[10]).toHaveLength(140);
		expect(lines[10]).toMatch(/^Zeile eins Zeile zwei y+$/);
		expect(new TextEncoder().encode(code.payload).length).toBeLessThanOrEqual(331);
	});

	it('keeps the payload within 331 UTF-8 bytes, cutting the Verwendungszweck by characters', () => {
		const code = giroCode({
			...input,
			name: 'Ä'.repeat(70),
			purpose: `Квартира ${'Ж'.repeat(120)} 😀`
		})!;
		const bytes = new TextEncoder().encode(code.payload).length;
		expect(bytes).toBeLessThanOrEqual(331);
		expect(bytes).toBeGreaterThan(325);
		const purpose = code.payload.split('\n')[10];
		expect(purpose).toMatch(/^Квартира Ж+$/);
		expect(code.lines.at(-1)).toBe(`Verwendungszweck: ${purpose}`);
		// 70 four-byte characters leave no room once the amount is long, even without a purpose.
		expect(giroCode({ ...input, name: '😀'.repeat(70), amount: 99_999_999_999 })).toBeUndefined();
		expect(giroCode({ ...input, name: `Erika ${'😀'.repeat(80)}` })!.payload.split('\n')[5]).toBe(
			`Erika ${'😀'.repeat(64)}`
		);
	});

	it('makes no code without an IBAN, a name or something to pay', () => {
		expect(giroCode({ ...input, iban: null })).toBeUndefined();
		expect(giroCode({ ...input, iban: 'Sparkasse' })).toBeUndefined();
		expect(giroCode({ ...input, name: '  ' })).toBeUndefined();
		expect(giroCode({ ...input, amount: 0 })).toBeUndefined();
		expect(giroCode({ ...input, amount: -500 })).toBeUndefined();
		expect(giroCode({ ...input, amount: 10.5 })).toBeUndefined();
		expect(giroCode({ ...input, amount: 100_000_000_000 })).toBeUndefined();
	});

	it('leaves out an empty Verwendungszweck in the lines', () => {
		expect(giroCode({ ...input, purpose: '' })!.lines).toHaveLength(3);
	});
});

describe('ibanNamedIn', () => {
	it('returns the IBAN only when the letter names it, in any spacing', () => {
		const text = 'Bitte überweisen Sie auf das Konto IBAN DE02 1203 0000 0000 2020 51.';
		expect(ibanNamedIn(text, 'DE02120300000000202051')).toBe('DE02120300000000202051');
		expect(ibanNamedIn(text, 'de02 1203 0000 0000 2020 51')).toBe('DE02120300000000202051');
		expect(ibanNamedIn(text, 'DE63100500006600099110')).toBeNull();
		expect(ibanNamedIn(text, null)).toBeNull();
	});
});

describe('paymentPurpose', () => {
	it('joins what, units and last names', () => {
		expect(paymentPurpose('Mietrückstand', ['Wohnung 3', 'Stellplatz 1'], ['Müller', 'Kaya'])).toBe(
			'Mietrückstand, Wohnung 3 + Stellplatz 1, Müller, Kaya'
		);
		expect(paymentPurpose('Mietrückstand', [], [''])).toBe('Mietrückstand');
	});
});

describe('giroCodeModules', () => {
	it('encodes a square code with the finder patterns in three corners', () => {
		const modules = giroCodeModules(giroCode(input)!.payload);
		const size = modules.length;
		expect(size).toBeGreaterThanOrEqual(21);
		expect((size - 17) % 4).toBe(0);
		expect(modules.every((row) => row.length === size)).toBe(true);
		const finder = (top: number, left: number) =>
			[0, 6].every(
				(offset) =>
					modules[top + offset].slice(left, left + 7).every(Boolean) &&
					modules.slice(top, top + 7).every((row) => row[left + offset])
			);
		expect(finder(0, 0)).toBe(true);
		expect(finder(0, size - 7)).toBe(true);
		expect(finder(size - 7, 0)).toBe(true);
	});
});
