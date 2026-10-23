import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatCents } from '../money';
import type { Database } from './db';
import { auditLog, paymentReminders } from './db/schema';
import { createPayment } from './ledger';
import {
	createReminder,
	deleteReminder,
	listRemindersByLease,
	reminderLetter,
	reminderState
} from './reminders';
import { contextA, contextB, seedLease, seedUnit, testDatabase } from './testing';

let db: Database;
let leaseId: string;

// 800 € a month from 2025-01-01, due 06.01., 05.02., 05.03.; paid January and 300 € of February.
beforeEach(async () => {
	db = await testDatabase();
	const { unitId } = await seedUnit(db, 'a');
	leaseId = await seedLease(db, 'a', unitId);
	for (const [date, amount] of [
		['2025-01-06', 80000],
		['2025-02-10', 30000]
	] as const) {
		await createPayment(db, contextA, { leaseId, date, amount, source: 'manual' });
	}
});

const input = { level: 1 as const, date: '2025-03-10', paymentDeadline: '2025-03-24' };

describe('reminderState', () => {
	it('lists what is open on the day and suggests a Zahlungserinnerung first', async () => {
		const state = await reminderState(db, 'a', leaseId, '2025-03-10');
		expect(state.items.map((item) => [item.label, item.open])).toEqual([
			['Miete Februar 2025', 50000],
			['Miete März 2025', 80000]
		]);
		expect(state.overdue).toBe(130000);
		expect(state.suggestedLevel).toBe(1);
	});

	it('suggests the next level after a letter about the same Rückstand', async () => {
		await createReminder(db, contextA, leaseId, input);
		const state = await reminderState(db, 'a', leaseId, '2025-03-20');
		expect(state.current).toHaveLength(1);
		expect(state.suggestedLevel).toBe(2);
	});

	it('forgets letters about arrears paid since', async () => {
		await createReminder(db, contextA, leaseId, input);
		await createPayment(db, contextA, {
			leaseId,
			date: '2025-03-20',
			amount: 130000,
			source: 'manual'
		});
		const state = await reminderState(db, 'a', leaseId, '2025-04-10');
		expect(state.items.map((item) => item.label)).toEqual(['Miete April 2025']);
		expect(state.reminders).toHaveLength(1);
		expect(state.current).toEqual([]);
		expect(state.suggestedLevel).toBe(1);
	});
});

describe('createReminder', () => {
	it('stores the items and the text as of the letter date, with an audit entry', async () => {
		const result = await createReminder(db, contextA, leaseId, input);
		expect(result?.ok).toBe(true);
		const [row] = await db.select().from(paymentReminders);
		expect(row).toMatchObject({ leaseId, level: 1, amount: 130000, date: '2025-03-10' });
		expect(row.items).toHaveLength(2);
		expect(row.letterText).toContain('bis zum 24.03.2025');
		const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, leaseId));
		expect(audit.map((entry) => entry.summary)).toContain(
			`Zahlungserinnerung vom 10.03.2025 über ${formatCents(130000)} erstellt`
		);
	});

	it('names the previous letter in a Mahnung', async () => {
		await createReminder(db, contextA, leaseId, input);
		await createReminder(db, contextA, leaseId, {
			level: 2,
			date: '2025-03-28',
			paymentDeadline: '2025-04-04'
		});
		const [mahnung] = await db.select().from(paymentReminders).where(eq(paymentReminders.level, 2));
		expect(mahnung.letterText).toContain('obwohl wir dich am 10.03.2025 daran erinnert haben');
	});

	it('refuses a letter when nothing is overdue and a deadline before the letter', async () => {
		expect(
			await createReminder(db, contextA, leaseId, {
				...input,
				date: '2025-01-10',
				paymentDeadline: '2025-01-24'
			})
		).toEqual({ ok: false, message: 'Am 10.01.2025 ist auf diesem Mietkonto nichts überfällig.' });
		expect(
			await createReminder(db, contextA, leaseId, { ...input, paymentDeadline: '2025-03-10' })
		).toMatchObject({ ok: false });
		expect(await db.select().from(paymentReminders)).toEqual([]);
	});

	it('refuses a letter dated in the future', async () => {
		expect(
			await createReminder(db, contextA, leaseId, {
				...input,
				date: '2099-01-10',
				paymentDeadline: '2099-01-24'
			})
		).toEqual({ ok: false, message: 'Das Schreiben kann nicht in die Zukunft datiert werden.' });
	});

	it('counts a refund as owed again, like the Rückstand of the ledger', async () => {
		await createPayment(db, contextA, {
			leaseId,
			date: '2025-03-07',
			amount: -10000,
			source: 'manual'
		});
		const state = await reminderState(db, 'a', leaseId, '2025-03-10');
		expect(state.overdue).toBe(140000);
		expect(state.items.map((item) => item.label)).toContain('Rückzahlung');
	});

	it('does not write to a lease of another account', async () => {
		expect(await createReminder(db, contextB, leaseId, input)).toBeUndefined();
	});
});

describe('the letters of a lease', () => {
	it('render as a letter with the open items table, only for the own account', async () => {
		const result = await createReminder(db, contextA, leaseId, input);
		if (!result?.ok) throw new Error('setup failed');
		const pdf = await reminderLetter(db, 'a', leaseId, result.id);
		expect(pdf?.filename).toBe('Zahlungserinnerung EG links 10.03.2025.pdf');
		expect(pdf?.letter.subject).toBe('Zahlungserinnerung zum Mietkonto EG links');
		const table = pdf?.letter.blocks?.find((block) => 'table' in block);
		expect(table && 'table' in table ? table.table.footer : undefined).toEqual([
			'',
			'Summe',
			formatCents(130000)
		]);
		expect(await reminderLetter(db, 'b', leaseId, result.id)).toBeUndefined();
	});

	it('are listed by lease and deleted with an audit entry', async () => {
		const result = await createReminder(db, contextA, leaseId, input);
		if (!result?.ok) throw new Error('setup failed');
		expect((await listRemindersByLease(db, 'a')).get(leaseId)).toHaveLength(1);
		expect((await listRemindersByLease(db, 'b')).size).toBe(0);
		expect(await deleteReminder(db, contextB, leaseId, result.id)).toBe(false);
		expect(await deleteReminder(db, contextA, leaseId, result.id)).toBe(true);
		expect(await db.select().from(paymentReminders)).toEqual([]);
	});
});
