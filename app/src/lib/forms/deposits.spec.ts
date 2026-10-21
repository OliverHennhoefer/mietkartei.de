import { describe, expect, it } from 'vitest';
import { parseDepositMovement } from './deposits';
import { formDataOf } from './fields';

describe('parseDepositMovement', () => {
	it('parses a movement with a German amount', () => {
		expect(
			parseDepositMovement(
				formDataOf({ date: '2026-01-05', kind: 'received', amount: '1.200,50', note: 'Rate 1' })
			)
		).toEqual({
			ok: true,
			data: { date: '2026-01-05', kind: 'received', amount: 120050, note: 'Rate 1' }
		});
	});

	it('requires the date, a known kind and an amount above zero', () => {
		const result = parseDepositMovement(formDataOf({ kind: 'bonus', amount: '0' }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual({
			date: 'Bitte gib ein Datum an.',
			kind: 'Bitte wähle einen gültigen Eintrag aus.',
			amount: 'Bitte gib einen Betrag über 0 € an.'
		});
		expect(result.values.amount).toBe('0');
	});
});
