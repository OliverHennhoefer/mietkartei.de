import { describe, expect, it } from 'vitest';
import { formatCents } from '../money';
import {
	currentReminders,
	defaultPaymentDeadline,
	nextLevel,
	openItems,
	reminderRows,
	reminderText,
	type ReminderContent,
	type SentReminder
} from './reminders';

const rent = (month: string, dueDate: string | null, amount = 80000) => ({
	label: `Miete ${month}`,
	dueDate,
	amount
});

describe('openItems', () => {
	const charges = [
		rent('März', '2025-03-05'),
		rent('Januar', '2025-01-06'),
		rent('Februar', '2025-02-05'),
		rent('April', '2025-04-03')
	];

	it('settles the oldest charges first and leaves the rest open', () => {
		expect(openItems(charges, 110000, '2025-03-10')).toEqual([
			{ label: 'Miete Februar', dueDate: '2025-02-05', amount: 80000, open: 50000 },
			{ label: 'Miete März', dueDate: '2025-03-05', amount: 80000, open: 80000 }
		]);
	});

	it('leaves out charges not due on the day and those without a due date', () => {
		const items = openItems([...charges, rent('Abrechnung', null, 20000)], 0, '2025-02-05');
		expect(items.map((item) => item.label)).toEqual(['Miete Januar', 'Miete Februar']);
	});

	it('counts due credits like payments', () => {
		const credit = { label: 'Korrektur', dueDate: '2025-01-10', amount: -30000 };
		expect(openItems([...charges, credit], 80000, '2025-02-05')).toEqual([
			{ label: 'Miete Februar', dueDate: '2025-02-05', amount: 80000, open: 50000 }
		]);
	});

	it('is empty when the payments cover everything due', () => {
		expect(openItems(charges, 240000, '2025-03-31')).toEqual([]);
	});

	it('keeps a refund passed as a charge open after the rent it follows', () => {
		const refund = { label: 'Rückzahlung', dueDate: '2025-01-20', amount: 10000 };
		expect(openItems([...charges, refund], 80000, '2025-01-31')).toEqual([
			{ label: 'Rückzahlung', dueDate: '2025-01-20', amount: 10000, open: 10000 }
		]);
	});
});

describe('currentReminders and nextLevel', () => {
	const sent: SentReminder[] = [
		{ level: 1, date: '2024-11-20', paymentDeadline: '2024-12-04' },
		{ level: 1, date: '2025-02-12', paymentDeadline: '2025-02-26' },
		{ level: 2, date: '2025-03-01', paymentDeadline: '2025-03-15' }
	];

	it('keeps the letters since the month of the oldest open item, newest first', () => {
		expect(currentReminders(sent, '2025-02-05').map((reminder) => reminder.date)).toEqual([
			'2025-03-01',
			'2025-02-12'
		]);
		expect(currentReminders(sent, null)).toEqual([]);
	});

	it('suggests one level above the highest, at most the last Mahnung', () => {
		expect(nextLevel([])).toBe(1);
		expect(nextLevel(currentReminders(sent, '2025-02-05'))).toBe(3);
		expect(nextLevel([{ level: 3, date: '2025-04-01', paymentDeadline: '2025-04-08' }])).toBe(3);
	});
});

describe('the letter', () => {
	const content: ReminderContent = {
		level: 1,
		date: '2025-03-10',
		paymentDeadline: defaultPaymentDeadline('2025-03-10'),
		unitName: 'EG links',
		tenants: [{ salutation: 'Frau', firstName: 'Erika', lastName: 'Muster' }],
		amount: 130000,
		previous: null,
		iban: 'DE02120300000000202051',
		bankName: 'Testbank'
	};

	it('suggests a deadline two weeks after the letter', () => {
		expect(content.paymentDeadline).toBe('2025-03-24');
	});

	it('asks one tenant to pay by the deadline, with the account', () => {
		const paragraphs = reminderText(content).split('\n\n');
		expect(paragraphs[0]).toBe('Guten Tag Frau Muster,');
		expect(paragraphs[1]).toBe(
			'auf deinem Mietkonto für EG links sind am 10.03.2025 folgende fällige Beträge offen:'
		);
		expect(paragraphs[2]).toContain(
			`Bitte überweise den offenen Betrag von ${formatCents(130000)}`
		);
		expect(paragraphs[2]).toContain('bis zum 24.03.2025 auf das Konto IBAN DE02120300000000202051');
		expect(paragraphs).toHaveLength(5);
	});

	it('addresses several tenants in the plural and names the previous letter', () => {
		const text = reminderText({
			...content,
			level: 2,
			tenants: [...content.tenants, { salutation: null, firstName: 'Max', lastName: 'Muster' }],
			previous: { level: 1, date: '2025-02-12', paymentDeadline: '2025-02-26' },
			iban: null,
			bankName: null
		});
		expect(text).toContain(
			'auf eurem Mietkonto für EG links sind am 10.03.2025 folgende fällige Beträge offen, obwohl wir euch am 12.02.2025 daran erinnert haben:'
		);
		expect(text).toContain(
			`Bitte überweist den offenen Betrag von ${formatCents(130000)} spätestens bis zum 24.03.2025.`
		);
		expect(text).toContain('seid ihr in Verzug');
	});

	it('announces legal steps in the last Mahnung', () => {
		const text = reminderText({ ...content, level: 3 });
		expect(text).toContain('Wir fordern dich letztmalig auf');
		expect(text).toContain('§ 543 Abs. 2 Satz 1 Nr. 3 BGB');
		expect(text).not.toContain('Schwierigkeiten');
	});

	it('marks partly paid items in the table', () => {
		expect(
			reminderRows([
				{ label: 'Miete Februar 2025', dueDate: '2025-02-05', amount: 80000, open: 50000 },
				{ label: 'Miete März 2025', dueDate: '2025-03-05', amount: 80000, open: 80000 }
			])
		).toEqual([
			[
				'05.02.2025',
				`Miete Februar 2025 (von ${formatCents(80000)} noch offen)`,
				formatCents(50000)
			],
			['05.03.2025', 'Miete März 2025', formatCents(80000)]
		]);
	});
});
