import { and, asc, eq } from 'drizzle-orm';
import { addMonthsToMonth, formatDate, monthOf, type IsoDate } from '../dates';
import { depositTransactionKindLabels } from '../labels';
import { distributeCents, formatCents } from '../money';
import { nthWorkingDay } from '../working-days';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { depositTransactions, type DepositTransactionKind } from './db/schema';
import { getLease } from './leases';

// The deposit ledger (Kaution) of a lease, kept apart from the rent. Amounts are signed from the
// deposit's point of view: received and interest add to it (positive), returned and withheld
// take from it (negative). The Kaution tab books them by hand, the banking feature from bank
// transactions.

export type DepositMovement = typeof depositTransactions.$inferSelect;

export type DepositMovementInput = {
	leaseId: string;
	date: IsoDate;
	kind: DepositTransactionKind;
	/** The amount as typed; the sign is set from the kind. */
	amount: number;
	note?: string | null;
};

/** Positive for money that goes into the deposit, negative for money that leaves it. */
export function signedDepositAmount(kind: DepositTransactionKind, amount: number): number {
	const absolute = Math.abs(amount);
	return kind === 'received' || kind === 'interest' ? absolute : -absolute;
}

/** All movements of the lease, oldest first. */
export async function listDepositMovements(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<DepositMovement[]> {
	return db
		.select()
		.from(depositTransactions)
		.where(
			and(eq(depositTransactions.accountId, accountId), eq(depositTransactions.leaseId, leaseId))
		)
		.orderBy(asc(depositTransactions.date), asc(depositTransactions.createdAt));
}

export type DepositSummary = {
	/** Paid in by the tenant. */
	received: number;
	interest: number;
	/** Paid back to the tenant, as a positive number. */
	returned: number;
	/** Kept by the landlord, as a positive number. */
	withheld: number;
	/** received + interest − returned − withheld: what the deposit account holds. */
	held: number;
	/** What the tenant still has to pay in: agreed − received, never below zero. */
	outstanding: number;
};

/** The totals of the movements against the agreed deposit. */
export function depositSummary(
	movements: readonly { kind: DepositTransactionKind; amount: number }[],
	agreed: number
): DepositSummary {
	const summary = { received: 0, interest: 0, returned: 0, withheld: 0, held: 0 };
	for (const movement of movements) {
		summary[movement.kind] += Math.abs(movement.amount);
		summary.held += signedDepositAmount(movement.kind, movement.amount);
	}
	return { ...summary, outstanding: Math.max(0, agreed - summary.received) };
}

function movementSummary(
	movement: { kind: DepositTransactionKind; date: IsoDate; amount: number },
	verb: string
): string {
	const label = depositTransactionKindLabels[movement.kind];
	return `Kaution ${label.toLowerCase()}: ${formatCents(Math.abs(movement.amount))} vom ${formatDate(movement.date)} ${verb}`;
}

/** Books a movement with its audit entry. Returns undefined when the lease is not in the account. */
export async function addDepositMovement(
	db: Database,
	context: AuditContext,
	input: DepositMovementInput
): Promise<string | undefined> {
	if (!(await getLease(db, context.accountId, input.leaseId))) return undefined;
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(depositTransactions).values({
			id,
			accountId: context.accountId,
			leaseId: input.leaseId,
			date: input.date,
			amount: signedDepositAmount(input.kind, input.amount),
			kind: input.kind,
			note: input.note ?? null
		}),
		auditEntry(db, context, 'lease', input.leaseId, 'create', movementSummary(input, 'gebucht'))
	]);
	return id;
}

/**
 * Deletes a movement of the lease with its audit entry; a movement of another lease is missing.
 * A movement assigned from a bank transaction is undone by the banking feature, which also
 * resets the transaction; deleting it here would leave the transaction marked as matched.
 */
export async function deleteDepositMovement(
	db: Database,
	context: AuditContext,
	leaseId: string,
	movementId: string
): Promise<'deleted' | 'from-bank' | 'missing'> {
	const [movement] = await db
		.select()
		.from(depositTransactions)
		.where(
			and(
				eq(depositTransactions.accountId, context.accountId),
				eq(depositTransactions.leaseId, leaseId),
				eq(depositTransactions.id, movementId)
			)
		);
	if (!movement) return 'missing';
	if (movement.bankTransactionId) return 'from-bank';
	await runBatch(db, [
		db
			.delete(depositTransactions)
			.where(
				and(
					eq(depositTransactions.accountId, context.accountId),
					eq(depositTransactions.id, movementId)
				)
			),
		auditEntry(
			db,
			context,
			'lease',
			movement.leaseId,
			'delete',
			movementSummary(movement, 'gelöscht')
		)
	]);
	return 'deleted';
}

export type DepositInstalment = { dueDate: IsoDate; amount: number };

/**
 * § 551 Abs. 2 BGB: a residential tenant may pay the deposit in three equal monthly instalments,
 * the first at the start of the tenancy, the others with the two following rents. The dates are
 * the rent due days of the first three months of the lease (the n-th working day, as in the
 * ledger, from the start date even when the ledger starts later and whatever the end date or the
 * rent history), the first one not before the start date; the amounts split the agreed deposit to
 * the cent. Empty for commercial and parking leases, for a lease without a deposit, and for an
 * unknown lease.
 */
export async function instalmentDeadlines(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<DepositInstalment[]> {
	const lease = await getLease(db, accountId, leaseId);
	if (!lease || lease.kind !== 'residential' || lease.securityDeposit <= 0) return [];
	const amounts = distributeCents(lease.securityDeposit, [1, 1, 1]);
	return amounts.map((amount, index) => {
		const dueDate = nthWorkingDay(
			addMonthsToMonth(monthOf(lease.startDate), index),
			lease.rentDueDay
		);
		// The first instalment is due at the start of the tenancy, never before it (a lease starting
		// on the 15th has its first rent due on the 3rd working day of the month).
		return { dueDate: dueDate < lease.startDate ? lease.startDate : dueDate, amount };
	});
}
