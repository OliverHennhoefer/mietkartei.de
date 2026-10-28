import { and, eq } from 'drizzle-orm';
import { formatDate, today, type IsoDate } from '../dates';
import {
	settlementFigures,
	settlementRows,
	settlementText,
	type SettlementInput
} from '../domain/deposit-settlement';
import { letterText as editedLetterText, type LetterTextResult } from '../domain/letters';
import { formatCents } from '../money';
import { addressLines, landlordAddress } from './accounts';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { depositSettlements, depositTransactions, payments } from './db/schema';
import { depositSummary, listDepositMovements } from './deposits';
import { getLease } from './leases';
import { listLedger } from './ledger';
import type { Letter } from './pdf';
import { assertQuota } from './quotas';
import { recipientLines } from './rent-adjustments';

// The Kautionsabrechnung of a lease: one per lease once it has ended, stored with its letter.
// Creating it books interest, Einbehalte, the offset against arrears (a deposit movement and a
// payment on the rent ledger) and the payout; deleting it takes these bookings out again.

export type SettlementRow = typeof depositSettlements.$inferSelect;

export type SettlementResult =
	{ ok: true; id: string } | { ok: false; message: string; arrears?: number };

const refuse = (message: string) => ({ ok: false as const, message });

export async function getSettlement(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<SettlementRow | undefined> {
	const [row] = await db
		.select()
		.from(depositSettlements)
		.where(
			and(eq(depositSettlements.accountId, accountId), eq(depositSettlements.leaseId, leaseId))
		);
	return row;
}

/** Arrears on the rent ledger on the day; positive = owed. */
export async function arrearsOn(
	db: Database,
	accountId: string,
	leaseId: string,
	date: IsoDate
): Promise<number> {
	return (await listLedger(db, accountId, leaseId, { to: date })).balance;
}

/**
 * Settles the deposit of an ended lease. Refused before the end, for a date in the future or
 * before the last deposit movement, a second time, when the Einbehalte exceed the deposit or when
 * the arrears to offset differ from those the form showed. Undefined when the lease is not in the
 * account.
 */
export async function createSettlement(
	db: Database,
	context: AuditContext,
	leaseId: string,
	input: SettlementInput
): Promise<SettlementResult | undefined> {
	const { accountId } = context;
	const lease = await getLease(db, accountId, leaseId);
	if (!lease) return undefined;
	if (!lease.endDate || lease.endDate > input.date) {
		return refuse(
			lease.endDate
				? `Die Kaution lässt sich erst ab dem Vertragsende am ${formatDate(lease.endDate)} abrechnen.`
				: 'Die Kaution lässt sich erst abrechnen, wenn der Mietvertrag ein Ende hat.'
		);
	}
	if (input.date > today()) return refuse('Die Abrechnung kann nicht in der Zukunft liegen.');
	if (await getSettlement(db, accountId, leaseId)) {
		return refuse('Die Kaution ist schon abgerechnet.');
	}
	await assertQuota(db, accountId, 'depositTransactions');
	const [movements, arrears, landlord] = await Promise.all([
		listDepositMovements(db, accountId, leaseId),
		arrearsOn(db, accountId, leaseId, input.date),
		landlordAddress(db, accountId)
	]);
	// The balance is the one on the date: a movement after it would be settled before it happened.
	const last = movements.at(-1);
	if (last && last.date > input.date) {
		return refuse(
			`Die Abrechnung kann nicht vor der letzten Kautionsbewegung am ${formatDate(last.date)} liegen.`
		);
	}
	const owed = Math.max(0, arrears);
	if (input.offsetArrears && input.shownArrears !== undefined && input.shownArrears !== owed) {
		return {
			...refuse(
				`Am ${formatDate(input.date)} beträgt der Mietrückstand ${formatCents(owed)}. Prüfe die Auszahlung und rechne erneut ab.`
			),
			arrears: owed
		};
	}
	const result = settlementFigures(
		depositSummary(movements, lease.securityDeposit),
		input,
		arrears
	);
	if (!result.ok) return result;
	const { figures } = result;

	const id = crypto.randomUUID();
	const movement = (kind: 'interest' | 'withheld' | 'returned', amount: number, note: string) =>
		db.insert(depositTransactions).values({
			accountId,
			leaseId,
			date: input.date,
			kind,
			amount: kind === 'interest' ? amount : -amount,
			note,
			settlementId: id
		});
	await runBatch(db, [
		db.insert(depositSettlements).values({
			id,
			accountId,
			leaseId,
			date: input.date,
			payout: figures.payout,
			remaining: figures.remaining,
			items: settlementRows(figures),
			letterText: settlementText({
				tenants: lease.tenants,
				unitName: lease.unit.name,
				endDate: lease.endDate,
				figures,
				iban: landlord.iban
			})
		}),
		...(figures.newInterest > 0
			? [movement('interest', figures.newInterest, 'Zinsen bis zur Kautionsabrechnung')]
			: []),
		...figures.deductions.map((deduction) =>
			movement('withheld', deduction.amount, `Einbehalt: ${deduction.label}`)
		),
		...(figures.offset > 0
			? [
					movement('withheld', figures.offset, 'Verrechnet mit dem Mietrückstand'),
					db.insert(payments).values({
						accountId,
						leaseId,
						date: input.date,
						amount: figures.offset,
						source: 'deposit',
						note: 'Verrechnet mit der Kaution',
						settlementId: id
					})
				]
			: []),
		...(figures.payout > 0
			? [movement('returned', figures.payout, 'Auszahlung laut Kautionsabrechnung')]
			: []),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'create',
			`Kautionsabrechnung vom ${formatDate(input.date)} erstellt: Auszahlung ${formatCents(figures.payout)}`
		)
	]);
	return { ok: true, id };
}

/** Deletes the settlement of the lease with its bookings; false when there is none. */
export async function deleteSettlement(
	db: Database,
	context: AuditContext,
	leaseId: string
): Promise<boolean> {
	const settlement = await getSettlement(db, context.accountId, leaseId);
	if (!settlement) return false;
	const { accountId } = context;
	await runBatch(db, [
		db
			.delete(depositTransactions)
			.where(
				and(
					eq(depositTransactions.accountId, accountId),
					eq(depositTransactions.settlementId, settlement.id)
				)
			),
		db
			.delete(payments)
			.where(and(eq(payments.accountId, accountId), eq(payments.settlementId, settlement.id))),
		db
			.delete(depositSettlements)
			.where(
				and(eq(depositSettlements.accountId, accountId), eq(depositSettlements.id, settlement.id))
			),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'delete',
			`Kautionsabrechnung vom ${formatDate(settlement.date)} gelöscht`
		)
	]);
	return true;
}

/**
 * Replaces the text of the letter with the paragraphs edited on its sheet; the first two stay, as
 * the table follows the second. Undefined when the lease has no settlement.
 */
export async function updateSettlementText(
	db: Database,
	context: AuditContext,
	leaseId: string,
	paragraphs: unknown
): Promise<LetterTextResult | undefined> {
	const settlement = await getSettlement(db, context.accountId, leaseId);
	if (!settlement) return undefined;
	const result = editedLetterText(paragraphs, 2);
	if (!result.ok || result.text === settlement.letterText) return result;
	await runBatch(db, [
		db
			.update(depositSettlements)
			.set({ letterText: result.text })
			.where(
				and(
					eq(depositSettlements.accountId, context.accountId),
					eq(depositSettlements.id, settlement.id)
				)
			),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'update',
			`Text der Kautionsabrechnung vom ${formatDate(settlement.date)} geändert`
		)
	]);
	return result;
}

/** The stored settlement as a Letter for renderLetter; undefined when the lease has none. */
export async function settlementLetter(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<{ letter: Letter; filename: string } | undefined> {
	const settlement = await getSettlement(db, accountId, leaseId);
	if (!settlement) return undefined;
	const lease = await getLease(db, accountId, leaseId);
	if (!lease) return undefined;
	const landlord = await landlordAddress(db, accountId);
	const date = formatDate(settlement.date);
	const [salutation, intro, ...rest] = settlement.letterText.split('\n\n');
	const letter: Letter = {
		sender: addressLines(landlord),
		recipient: recipientLines(lease),
		date: landlord.city ? `${landlord.city}, ${date}` : date,
		subject: `Abrechnung der Mietsicherheit für ${lease.unit.name}`,
		paragraphs: [],
		blocks: [
			{ paragraph: salutation },
			{ paragraph: intro },
			{
				table: {
					columns: [{ label: 'Posten' }, { label: 'Betrag', align: 'right', width: 0.25 }],
					rows: settlement.items,
					footer: ['Auszahlung an Sie', formatCents(settlement.payout)]
				}
			},
			...rest.map((paragraph) => ({ paragraph }))
		],
		closing: ['Mit freundlichen Grüßen', '', landlord.name]
	};
	const names = lease.tenants.map((tenant) => tenant.lastName).join(', ') || lease.unit.name;
	return { letter, filename: `Kautionsabrechnung ${names} ${date}.pdf` };
}
