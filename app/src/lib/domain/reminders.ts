import { addDays, firstOfMonth, formatDate, monthOf, type IsoDate } from '../dates';
import { formatCents } from '../money';
import type { ReminderLevel } from '../server/db/schema';
import { greeting, type LetterTenant } from './index-rent';

// Zahlungserinnerung and Mahnung: which due charges are still open, which level the next letter
// has and what it says. Rent is due on a calendar date, so the tenant is in default without a
// reminder (§ 286 Abs. 2 Nr. 1 BGB); the letters are a courtesy and a record, not a precondition.

export const reminderLevelLabels: Record<ReminderLevel, string> = {
	1: 'Zahlungserinnerung',
	2: 'Mahnung',
	3: 'Letzte Mahnung'
};

/** Days between the letter and the payment deadline the form suggests. */
export const DEFAULT_PAYMENT_DAYS = 14;

export function defaultPaymentDeadline(date: IsoDate): IsoDate {
	return addDays(date, DEFAULT_PAYMENT_DAYS);
}

export type DueCharge = { label: string; dueDate: IsoDate | null; amount: number };

export type OpenItem = {
	label: string;
	dueDate: IsoDate;
	amount: number;
	/** What is still unpaid of the charge, more than 0 and at most `amount`. */
	open: number;
};

/**
 * The charges due by `asOf` that the payments made by `asOf` do not cover, oldest first. Payments
 * and due credits settle the oldest charges first, as in the Rückstand of the ledger, so the open
 * amounts add up to that Rückstand.
 */
export function openItems(charges: readonly DueCharge[], paid: number, asOf: IsoDate): OpenItem[] {
	const due = charges
		.filter((charge): charge is DueCharge & { dueDate: IsoDate } =>
			Boolean(charge.dueDate && charge.dueDate <= asOf)
		)
		.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
	let available = due.reduce((sum, charge) => sum + Math.max(-charge.amount, 0), paid);
	const items: OpenItem[] = [];
	for (const charge of due) {
		if (charge.amount <= 0) continue;
		const settled = Math.min(Math.max(available, 0), charge.amount);
		available -= settled;
		if (settled < charge.amount) {
			items.push({
				label: charge.label,
				dueDate: charge.dueDate,
				amount: charge.amount,
				open: charge.amount - settled
			});
		}
	}
	return items;
}

export type SentReminder = { level: ReminderLevel; date: IsoDate; paymentDeadline: IsoDate };

/**
 * The letters sent since the current Rückstand began: those dated on or after the first day of
 * the month of the oldest open item. Earlier letters were about arrears that have been paid since.
 * Newest first.
 */
export function currentReminders<T extends SentReminder>(
	reminders: readonly T[],
	oldestOpen: IsoDate | null
): T[] {
	if (!oldestOpen) return [];
	const start = firstOfMonth(monthOf(oldestOpen));
	return reminders
		.filter((reminder) => reminder.date >= start)
		.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.level - a.level));
}

/** One level above the highest one sent for the current Rückstand, at most the last Mahnung. */
export function nextLevel(current: readonly SentReminder[]): ReminderLevel {
	const highest = current.reduce((max, reminder) => Math.max(max, reminder.level), 0);
	return Math.min(highest + 1, 3) as ReminderLevel;
}

export type ReminderContent = {
	level: ReminderLevel;
	date: IsoDate;
	paymentDeadline: IsoDate;
	unitName: string;
	tenants: readonly LetterTenant[];
	/** The overdue total. */
	amount: number;
	/** The latest letter sent before this one for the current Rückstand. */
	previous: SentReminder | null;
	iban: string | null;
	bankName: string | null;
};

/** The rows of the open items table: due date, posting, open amount. */
export function reminderRows(items: readonly OpenItem[]): string[][] {
	return items.map((item) => [
		formatDate(item.dueDate),
		item.open < item.amount
			? `${item.label} (von ${formatCents(item.amount)} noch offen)`
			: item.label,
		formatCents(item.open)
	]);
}

/**
 * The paragraphs of the letter, joined by blank lines; the open items table follows the second
 * one. In the informal register of the app, addressed to all tenants of the lease.
 */
export function reminderText(content: ReminderContent): string {
	const plural = content.tenants.length > 1;
	const you = (singular: string, several: string) => (plural ? several : singular);
	const amount = formatCents(content.amount);
	const deadline = formatDate(content.paymentDeadline);
	const account = [
		content.iban ? `IBAN ${content.iban}` : null,
		content.bankName ? `bei der ${content.bankName}` : null
	]
		.filter(Boolean)
		.join(' ');
	const toAccount = account ? ` auf das Konto ${account}` : '';
	const previous = content.previous
		? `, obwohl wir ${you('dich', 'euch')} am ${formatDate(content.previous.date)} daran erinnert haben`
		: '';
	const items =
		`auf ${you('deinem', 'eurem')} Mietkonto für ${content.unitName} sind ` +
		`am ${formatDate(content.date)} folgende fällige Beträge offen`;
	const alreadyPaid =
		`Falls ${you('du', 'ihr')} in den letzten Tagen schon gezahlt ${you('hast', 'habt')}, ` +
		`${you('betrachte', 'betrachtet')} dieses Schreiben bitte als gegenstandslos.`;
	const talk =
		`Wenn es gerade Schwierigkeiten gibt, ${you('melde dich', 'meldet euch')} bitte bei uns, ` +
		'dann finden wir gemeinsam eine Lösung.';

	const paragraphs: string[] = [greeting(content.tenants)];
	if (content.level === 1) {
		paragraphs.push(
			`${items}:`,
			`Sicher ist das nur ein Versehen. Bitte ${you('überweise', 'überweist')} den offenen ` +
				`Betrag von ${amount} bis zum ${deadline}${toAccount}.`,
			alreadyPaid,
			talk
		);
	} else if (content.level === 2) {
		paragraphs.push(
			`${items}${previous}:`,
			`Bitte ${you('überweise', 'überweist')} den offenen Betrag von ${amount} spätestens bis ` +
				`zum ${deadline}${toAccount}.`,
			`Die Miete ist zu festen Terminen fällig; mit dem Ablauf des Fälligkeitstags ${you('bist du', 'seid ihr')} ` +
				'in Verzug (§ 286 Abs. 2 Nr. 1 BGB). Wir behalten uns vor, Verzugszinsen (§ 288 BGB) ' +
				'geltend zu machen.',
			alreadyPaid,
			talk
		);
	} else {
		paragraphs.push(
			`${items}${previous}:`,
			`Wir fordern ${you('dich', 'euch')} letztmalig auf, den offenen Betrag von ${amount} bis ` +
				`zum ${deadline}${toAccount} zu überweisen.`,
			'Geht der Betrag bis dahin nicht ein, werden wir ohne weitere Ankündigung rechtliche ' +
				'Schritte einleiten. Ein Mietrückstand kann außerdem zur fristlosen Kündigung des ' +
				'Mietverhältnisses berechtigen (§ 543 Abs. 2 Satz 1 Nr. 3 BGB).',
			alreadyPaid
		);
	}
	return paragraphs.join('\n\n');
}
