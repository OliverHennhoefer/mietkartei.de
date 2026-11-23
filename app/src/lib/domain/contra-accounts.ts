import type { ContraAccountKind, PaymentContraAccountKind } from '../server/db/schema';

// Gegenkonten without a database: which of the landlord's accounts a booking goes to, and how a
// tenant's payment splits into Kaltmiete and Nebenkosten the way a bookkeeper books it
// („8005 Mieten Rudolf“ and „8006 NK Rudolf“).

export type ContraAccountRef = {
	id: string;
	kind: ContraAccountKind;
	propertyId: string | null;
};

/**
 * The Gegenkonto of a kind for a property: the one of that kind for the property, else the one
 * of that kind for no property in particular. Undefined when there is none or the choice is not
 * clear (two of them).
 */
export function contraAccountFor(
	accounts: readonly ContraAccountRef[],
	kind: ContraAccountKind,
	propertyId: string | null
): string | undefined {
	const single = (candidates: readonly ContraAccountRef[]) =>
		candidates.length === 1 ? candidates[0].id : undefined;
	const ofKind = accounts.filter((account) => account.kind === kind);
	const own = ofKind.filter((account) => propertyId && account.propertyId === propertyId);
	if (own.length) return single(own);
	return single(ofKind.filter((account) => !account.propertyId));
}

/** The parts of a monthly rent charge the split looks at, in cents. */
export type MonthlyCharge = {
	amount: number;
	operatingCostPrepayment: number;
	heatingCostPrepayment: number;
};

export type PaymentPart = { amount: number; contraAccountId: string | null };

/**
 * How a tenant's payment on one lease is booked. A payment of exactly a statement's Nachzahlung
 * (or the refund of its Guthaben) goes to the Nebenkosten-Vorjahr account. Otherwise, with a
 * Nebenkosten account, the payment splits in the proportion of the monthly charge: the full
 * charge exactly into Kaltmiete and Vorauszahlungen, a partial or larger one pro rata. Without a
 * Nebenkosten account or charge, all of it goes to the rent account (or none).
 */
export function splitPayment(
	amount: number,
	context: {
		monthly: MonthlyCharge | null;
		/** The amounts of the lease's recent statement charges: positive Nachzahlung, negative Guthaben. */
		statementBalances: readonly number[];
		accounts: Partial<Record<PaymentContraAccountKind, string>>;
	}
): PaymentPart[] {
	const { monthly, accounts } = context;
	if (accounts.statement_balance && context.statementBalances.includes(amount)) {
		return [{ amount, contraAccountId: accounts.statement_balance }];
	}
	const rent = accounts.rent ?? null;
	const prepayment = monthly ? monthly.operatingCostPrepayment + monthly.heatingCostPrepayment : 0;
	if (
		!accounts.operating_costs ||
		!monthly ||
		monthly.amount <= 0 ||
		prepayment <= 0 ||
		amount <= 0
	) {
		return [{ amount, contraAccountId: rent }];
	}
	const share =
		amount === monthly.amount ? prepayment : Math.round((amount * prepayment) / monthly.amount);
	const operatingCosts = Math.min(amount, Math.max(0, share));
	return [
		{ amount: amount - operatingCosts, contraAccountId: rent },
		{ amount: operatingCosts, contraAccountId: accounts.operating_costs }
	].filter((part) => part.amount !== 0);
}
