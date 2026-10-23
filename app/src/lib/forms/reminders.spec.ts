import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import { parseReminder } from './reminders';

describe('parseReminder', () => {
	it('reads the level as a number and both dates', () => {
		expect(
			parseReminder(formDataOf({ level: '2', date: '2025-03-10', paymentDeadline: '2025-03-24' }))
		).toEqual({ ok: true, data: { level: 2, date: '2025-03-10', paymentDeadline: '2025-03-24' } });
	});

	it('refuses an unknown level and a deadline not after the letter', () => {
		const result = parseReminder(
			formDataOf({ level: '4', date: '2025-03-10', paymentDeadline: '2025-03-10' })
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(Object.keys(result.errors).sort()).toEqual(['level', 'paymentDeadline']);
	});
});
