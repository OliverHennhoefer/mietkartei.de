import { and, desc, eq } from 'drizzle-orm';
import { formatDate, today, type IsoDate } from '../dates';
import {
	currentReminders,
	nextLevel,
	openItems,
	reminderLevelLabels,
	reminderRows,
	reminderText,
	type OpenItem
} from '../domain/reminders';
import { defaultInterest, type InterestResult } from '../domain/default-interest';
import { formatCents } from '../money';
import { addressLines, landlordAddress } from './accounts';
import { auditEntry, type AuditContext } from './audit';
import { currentBaseRates, type BaseRateState } from './base-rate';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { payments, paymentReminders, rentCharges, type ReminderLevel } from './db/schema';
import { getLease } from './leases';
import { chargeLabel, ensureCharges } from './ledger';
import type { Letter } from './pdf';
import { assertQuota } from './quotas';
import { recipientLines } from './rent-adjustments';

// Zahlungserinnerungen and Mahnungen of a lease: the open items on the day of the letter, the
// letters already sent and the PDF of each. A letter is stored with its items and text as
// written; deleting it only removes the record.

export type ReminderRow = typeof paymentReminders.$inferSelect;

/** The letters of a lease, newest first. */
export async function listReminders(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<ReminderRow[]> {
	return db
		.select()
		.from(paymentReminders)
		.where(and(eq(paymentReminders.accountId, accountId), eq(paymentReminders.leaseId, leaseId)))
		.orderBy(desc(paymentReminders.date), desc(paymentReminders.createdAt));
}

/** Every letter of the account by lease, newest first, for the overview of all arrears. */
export async function listRemindersByLease(
	db: Database,
	accountId: string
): Promise<Map<string, ReminderRow[]>> {
	const rows = await db
		.select()
		.from(paymentReminders)
		.where(eq(paymentReminders.accountId, accountId))
		.orderBy(desc(paymentReminders.date), desc(paymentReminders.createdAt));
	const byLease = new Map<string, ReminderRow[]>();
	for (const row of rows) {
		const group = byLease.get(row.leaseId);
		if (group) group.push(row);
		else byLease.set(row.leaseId, [row]);
	}
	return byLease;
}

/** The charges due by `asOf` that the payments made by then leave open; syncs the rent first. */
async function leaseOpenItems(
	db: Database,
	accountId: string,
	leaseId: string,
	asOf: IsoDate
): Promise<OpenItem[]> {
	await ensureCharges(db, accountId, [leaseId]);
	const [chargeRows, paymentRows] = await Promise.all([
		db
			.select({
				kind: rentCharges.kind,
				period: rentCharges.period,
				note: rentCharges.note,
				dueDate: rentCharges.dueDate,
				amount: rentCharges.amount
			})
			.from(rentCharges)
			.where(and(eq(rentCharges.accountId, accountId), eq(rentCharges.leaseId, leaseId))),
		db
			.select({ date: payments.date, amount: payments.amount, note: payments.note })
			.from(payments)
			.where(and(eq(payments.accountId, accountId), eq(payments.leaseId, leaseId)))
	]);
	const paid = paymentRows
		.filter((payment) => payment.amount > 0 && payment.date <= asOf)
		.reduce((sum, payment) => sum + payment.amount, 0);
	const charges = [
		...chargeRows.map((row) => ({
			label: chargeLabel(row),
			dueDate: row.dueDate,
			amount: row.amount
		})),
		// A refund is money the tenant got back: owed again from its date.
		...paymentRows
			.filter((payment) => payment.amount < 0)
			.map((payment) => ({
				label: payment.note || 'Rückzahlung',
				dueDate: payment.date,
				amount: -payment.amount
			}))
	];
	return openItems(charges, paid, asOf);
}

export type ReminderState = {
	/** What is open on `asOf`, oldest first. */
	items: OpenItem[];
	overdue: number;
	/** Every letter of the lease, newest first. */
	reminders: ReminderRow[];
	/** The letters sent since the current Rückstand began, newest first. */
	current: ReminderRow[];
	/** The level the next letter should have. */
	suggestedLevel: ReminderLevel;
	/** Verzugszinsen on the open items by `asOf`. */
	interest: InterestResult;
	/** The Basiszinssatz the interest is computed with. */
	baseRates: Omit<BaseRateState, 'rates'> & { latest: { validFrom: IsoDate; rate: number } | null };
};

/** The open items of a lease on `asOf` with its letters, for the Mietkonto tab. */
export async function reminderState(
	db: Database,
	accountId: string,
	leaseId: string,
	asOf: IsoDate = today()
): Promise<ReminderState> {
	const [items, reminders, baseRates] = await Promise.all([
		leaseOpenItems(db, accountId, leaseId, asOf),
		listReminders(db, accountId, leaseId),
		currentBaseRates(db, asOf)
	]);
	const current = currentReminders(reminders, items[0]?.dueDate ?? null);
	return {
		items,
		overdue: items.reduce((sum, item) => sum + item.open, 0),
		reminders,
		current,
		suggestedLevel: nextLevel(current),
		interest: defaultInterest(items, baseRates.rates, asOf),
		baseRates: {
			outdated: baseRates.outdated,
			error: baseRates.error,
			latest: baseRates.rates.at(-1) ?? null
		}
	};
}

export type ReminderInput = { level: ReminderLevel; date: IsoDate; paymentDeadline: IsoDate };

export type ReminderResult = { ok: true; id: string } | { ok: false; message: string };

function reminderSummary(reminder: { level: ReminderLevel; date: IsoDate; amount: number }) {
	return `${reminderLevelLabels[reminder.level]} vom ${formatDate(reminder.date)} über ${formatCents(reminder.amount)}`;
}

/**
 * Writes a letter about what is overdue on its date. Refused when nothing is. Returns undefined
 * when the lease is not in the account.
 */
export async function createReminder(
	db: Database,
	context: AuditContext,
	leaseId: string,
	input: ReminderInput
): Promise<ReminderResult | undefined> {
	const lease = await getLease(db, context.accountId, leaseId);
	if (!lease) return undefined;
	// The open items are those booked by the letter date; a later date would anticipate rent the
	// ledger does not hold yet.
	if (input.date > today()) {
		return { ok: false, message: 'Das Schreiben kann nicht in die Zukunft datiert werden.' };
	}
	if (input.paymentDeadline <= input.date) {
		return { ok: false, message: 'Die Zahlungsfrist muss nach dem Datum des Schreibens liegen.' };
	}
	const [items, reminders, landlord, baseRates] = await Promise.all([
		leaseOpenItems(db, context.accountId, leaseId, input.date),
		listReminders(db, context.accountId, leaseId),
		landlordAddress(db, context.accountId),
		currentBaseRates(db, input.date)
	]);
	if (items.length === 0) {
		return {
			ok: false,
			message: `Am ${formatDate(input.date)} ist auf diesem Mietkonto nichts überfällig.`
		};
	}
	await assertQuota(db, context.accountId, 'paymentReminders');
	const amount = items.reduce((sum, item) => sum + item.open, 0);
	const [previous] = currentReminders(
		reminders.filter((reminder) => reminder.date <= input.date),
		items[0].dueDate
	);
	const letterText = reminderText({
		...input,
		unitName: lease.unit.name,
		tenants: lease.tenants,
		amount,
		previous: previous ?? null,
		iban: landlord.iban,
		bankName: landlord.bankName,
		interest: defaultInterest(items, baseRates.rates, input.date).amount
	});
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(paymentReminders).values({
			id,
			accountId: context.accountId,
			leaseId,
			...input,
			amount,
			items: reminderRows(items),
			letterText
		}),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'create',
			`${reminderSummary({ ...input, amount })} erstellt`
		)
	]);
	return { ok: true, id };
}

export async function deleteReminder(
	db: Database,
	context: AuditContext,
	leaseId: string,
	reminderId: string
): Promise<boolean> {
	const where = and(
		eq(paymentReminders.accountId, context.accountId),
		eq(paymentReminders.leaseId, leaseId),
		eq(paymentReminders.id, reminderId)
	);
	const [reminder] = await db.select().from(paymentReminders).where(where);
	if (!reminder) return false;
	await runBatch(db, [
		db.delete(paymentReminders).where(where),
		auditEntry(db, context, 'lease', leaseId, 'delete', `${reminderSummary(reminder)} gelöscht`)
	]);
	return true;
}

/** A stored letter as a Letter for renderLetter; undefined when it is not the lease's. */
export async function reminderLetter(
	db: Database,
	accountId: string,
	leaseId: string,
	reminderId: string
): Promise<{ letter: Letter; filename: string } | undefined> {
	const [reminder] = await db
		.select()
		.from(paymentReminders)
		.where(
			and(
				eq(paymentReminders.accountId, accountId),
				eq(paymentReminders.leaseId, leaseId),
				eq(paymentReminders.id, reminderId)
			)
		);
	if (!reminder) return undefined;
	const lease = await getLease(db, accountId, leaseId);
	if (!lease) return undefined;
	const landlord = await landlordAddress(db, accountId);

	const label = reminderLevelLabels[reminder.level];
	const date = formatDate(reminder.date);
	// The table of open items follows the paragraph that announces it, the second one.
	const [salutation, intro, ...rest] = reminder.letterText.split('\n\n');
	const letter: Letter = {
		sender: addressLines(landlord),
		recipient: recipientLines(lease),
		date: landlord.city ? `${landlord.city}, ${date}` : date,
		subject: `${label} zum Mietkonto ${lease.unit.name}`,
		paragraphs: [],
		blocks: [
			{ paragraph: salutation },
			{ paragraph: intro },
			{
				table: {
					columns: [
						{ label: 'Fällig am', width: 0.18 },
						{ label: 'Buchung' },
						{ label: 'Offen', align: 'right', width: 0.2 }
					],
					rows: reminder.items,
					footer: ['', 'Summe', formatCents(reminder.amount)]
				}
			},
			...rest.map((paragraph) => ({ paragraph }))
		],
		closing: ['Mit freundlichen Grüßen', '', landlord.name]
	};
	const names = lease.tenants.map((tenant) => tenant.lastName).join(', ') || lease.unit.name;
	return { letter, filename: `${label} ${names} ${date}.pdf` };
}
