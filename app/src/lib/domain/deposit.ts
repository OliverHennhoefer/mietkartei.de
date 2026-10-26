import { addMonthsToMonth, monthOf, type IsoDate } from '../dates';
import { distributeCents } from '../money';
import type { LeaseKind } from '../server/db/schema';
import { nthWorkingDay, type GermanState } from '../working-days';

// The deposit instalments (Kaution in drei Raten) of a lease. Pure, so the Kaution tab and the
// Fristen list share one rule.

export type InstalmentLease = {
	kind: LeaseKind;
	startDate: IsoDate;
	rentDueDay: number;
	/** The agreed deposit in cents. */
	securityDeposit: number;
	/** Bundesland of the property, whose holidays are no working days. */
	state: GermanState | null;
};

export type DepositInstalment = { dueDate: IsoDate; amount: number };

/**
 * § 551 Abs. 2 BGB: a residential tenant may pay the deposit in three equal monthly instalments,
 * the first at the start of the tenancy, the others with the two following rents. The dates are
 * the rent due days of the first three months of the lease (the n-th working day, as in the
 * ledger, from the start date even when the ledger starts later and whatever the end date or the
 * rent history), the first one not before the start date; the amounts split the agreed deposit to
 * the cent. Empty for commercial and parking leases and for a lease without a deposit.
 */
export function depositInstalments(lease: InstalmentLease): DepositInstalment[] {
	if (lease.kind !== 'residential' || lease.securityDeposit <= 0) return [];
	const amounts = distributeCents(lease.securityDeposit, [1, 1, 1]);
	return amounts.map((amount, index) => {
		const dueDate = nthWorkingDay(
			addMonthsToMonth(monthOf(lease.startDate), index),
			lease.rentDueDay,
			lease.state
		);
		// The first instalment is due at the start of the tenancy, never before it (a lease starting
		// on the 15th has its first rent due on the 3rd working day of the month).
		return { dueDate: dueDate < lease.startDate ? lease.startDate : dueDate, amount };
	});
}
