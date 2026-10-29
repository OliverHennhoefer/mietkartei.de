import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import { ledgerRange, parseAdjustment, parsePayment } from './ledger';

describe('parsePayment', () => {
	it('parses a German amount into cents and keeps the note', () => {
		expect(
			parsePayment(formDataOf({ date: '2026-03-04', amount: '1.234,56', note: 'Überweisung' }))
		).toEqual({
			ok: true,
			data: { date: '2026-03-04', amount: 123456, note: 'Überweisung', side: null }
		});
	});

	it('allows a refund as a negative amount and an empty note', () => {
		expect(parsePayment(formDataOf({ date: '2026-03-04', amount: '-50', note: '' }))).toEqual({
			ok: true,
			data: { date: '2026-03-04', amount: -5000, note: null, side: null }
		});
	});

	it('takes the side and an amount without a sign from the Mietkonto form', () => {
		expect(
			parsePayment(formDataOf({ date: '2026-03-04', side: 'refund', amount: '50,00' }))
		).toMatchObject({ ok: true, data: { amount: -5000, side: 'refund' } });
		expect(
			parsePayment(formDataOf({ date: '2026-03-04', side: 'received', amount: '50,00' }))
		).toMatchObject({ ok: true, data: { amount: 5000 } });
		const signed = parsePayment(formDataOf({ date: '2026-03-04', side: 'refund', amount: '-50' }));
		expect(signed.ok).toBe(false);
	});

	it('refuses zero, a missing date and a malformed amount', () => {
		const zero = parsePayment(formDataOf({ date: '2026-03-04', amount: '0,00' }));
		expect(zero.ok).toBe(false);
		if (!zero.ok) expect(zero.errors).toEqual({ amount: 'Der Betrag darf nicht 0 sein.' });

		const missing = parsePayment(formDataOf({ date: '', amount: 'abc' }));
		expect(missing.ok).toBe(false);
		if (!missing.ok) {
			expect(missing.errors.date).toBe('Bitte gib ein Datum an.');
			expect(missing.errors.amount).toBe('Bitte gib einen Betrag an, z. B. 650,00.');
			expect(missing.values).toEqual({ date: '', side: '', amount: 'abc', note: '' });
		}
	});
});

describe('parseAdjustment', () => {
	it('parses a credit with its reason', () => {
		expect(
			parseAdjustment(
				formDataOf({ date: '2026-02-01', side: 'credit', amount: '120,00', note: 'Mietminderung' })
			)
		).toEqual({
			ok: true,
			data: { date: '2026-02-01', amount: -12000, note: 'Mietminderung', side: 'credit' }
		});
	});

	it('needs a side and an amount without a sign', () => {
		const result = parseAdjustment(formDataOf({ date: '2026-02-01', amount: '-30', note: 'x' }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toEqual({
				side: 'Bitte wähle einen Eintrag aus.',
				amount: 'Der Betrag darf nicht unter 0 € liegen.'
			});
		}
	});

	it('needs a reason', () => {
		const result = parseAdjustment(
			formDataOf({ date: '2026-02-01', side: 'claim', amount: '300' })
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors).toEqual({ note: 'Bitte fülle dieses Feld aus.' });
	});
});

describe('ledgerRange', () => {
	it('defaults to the last twelve months including the current one', () => {
		expect(ledgerRange(new URLSearchParams(), '2026-03-15')).toEqual({
			from: '2025-04',
			to: '2026-03'
		});
	});

	it('takes the months given and swaps them when reversed', () => {
		expect(ledgerRange(new URLSearchParams('from=2025-01&to=2025-06'), '2026-03-15')).toEqual({
			from: '2025-01',
			to: '2025-06'
		});
		expect(ledgerRange(new URLSearchParams('from=2025-06&to=2025-01'), '2026-03-15')).toEqual({
			from: '2025-01',
			to: '2025-06'
		});
	});

	it('falls back to the default when a parameter is not a month', () => {
		expect(ledgerRange(new URLSearchParams('from=2025-13&to=2025-06'), '2026-03-15')).toEqual({
			from: '2025-04',
			to: '2026-03'
		});
		expect(ledgerRange(new URLSearchParams('from=2025-01'), '2026-03-15')).toEqual({
			from: '2025-04',
			to: '2026-03'
		});
	});
});
