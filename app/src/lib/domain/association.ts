import { daysInclusive, overlapDays, type DateRange, type IsoDate } from '../dates';
import { formatCents, proRata } from '../money';

// The Hausgeldabrechnung of an Eigentumswohnung, pure: the Verwalter's figures for one
// Wirtschaftsjahr set against the Hausgeld the landlord paid and the Belege taken over into the
// tenant's Betriebskostenabrechnung. Nothing is read from the database.

/** Differences up to this (cents) are rounding and no finding. */
const TOLERANCE = 100;

export type AssociationFigures = {
	periodStart: IsoDate;
	periodEnd: IsoDate;
	allocableCosts: number;
	nonAllocableCosts: number;
	reserveContribution: number;
	feesDue: number;
	/** Positive = Nachzahlung, negative = Guthaben; null when not entered. */
	statedBalance: number | null;
};

/** A Beleg of the property with the figures of the WEG, as far as the reconciliation needs it. */
export type AssociationItem = {
	periodStart: IsoDate;
	periodEnd: IsoDate;
	amount: number;
	allocable: boolean;
};

export type AssociationFindingCode = 'balance' | 'fees' | 'allocable';

export type AssociationFinding = { code: AssociationFindingCode; message: string };

export type AssociationReconciliation = {
	/** The unit's costs of the year: allocable + non-allocable + Zuführung zur Rücklage. */
	costsTotal: number;
	/** Costs less the Hausgeld due: the Abrechnungsspitze as it follows from the figures. */
	computedBalance: number;
	/** Stated less computed balance; null without a stated one. */
	balanceDifference: number | null;
	/** The Hausgeld paid in the period (expenses of category association_fee). */
	feesPaid: number;
	/** Hausgeld due less paid: positive = still owed to the WEG, negative = paid in excess. */
	feesOutstanding: number;
	/** What the landlord still pays (positive) or gets back (negative): costs less Hausgeld paid. */
	settlement: number;
	/** The allocable Belege of the WEG, prorated to the period. */
	allocableRecorded: number;
	/** Allocable costs less the recorded ones: positive = not taken over into the statement. */
	allocableMissing: number;
	findings: AssociationFinding[];
};

/** The Verwalter's figures against the Hausgeld paid and the Belege taken over. */
export function reconcileAssociation(
	figures: AssociationFigures,
	feesPaid: number,
	items: readonly AssociationItem[]
): AssociationReconciliation {
	const period: DateRange = { start: figures.periodStart, end: figures.periodEnd };
	const costsTotal =
		figures.allocableCosts + figures.nonAllocableCosts + figures.reserveContribution;
	const computedBalance = costsTotal - figures.feesDue;
	const balanceDifference =
		figures.statedBalance === null ? null : figures.statedBalance - computedBalance;
	const feesOutstanding = figures.feesDue - feesPaid;
	let allocableRecorded = 0;
	for (const item of items) {
		if (!item.allocable) continue;
		const days = overlapDays(period, { start: item.periodStart, end: item.periodEnd });
		allocableRecorded += proRata(
			item.amount,
			days,
			daysInclusive(item.periodStart, item.periodEnd)
		);
	}
	const allocableMissing = figures.allocableCosts - allocableRecorded;

	const findings: AssociationFinding[] = [];
	if (balanceDifference !== null && Math.abs(balanceDifference) > TOLERANCE) {
		findings.push({
			code: 'balance',
			message: `Die Abrechnungsspitze laut Verwalter (${signed(figures.statedBalance!)}) weicht um ${formatCents(Math.abs(balanceDifference))} davon ab, was sich aus Kosten und Hausgeld laut Wirtschaftsplan ergibt (${signed(computedBalance)}). Prüfe die eingetragenen Summen.`
		});
	}
	if (feesOutstanding > TOLERANCE) {
		findings.push({
			code: 'fees',
			message: `Vom Hausgeld laut Wirtschaftsplan (${formatCents(figures.feesDue)}) sind ${formatCents(feesPaid)} als Ausgabe erfasst; es fehlen ${formatCents(feesOutstanding)}. Erfasse die fehlenden Zahlungen als Ausgabe „Hausgeld (WEG)“ oder kläre den Rückstand mit dem Verwalter.`
		});
	} else if (feesOutstanding < -TOLERANCE) {
		findings.push({
			code: 'fees',
			message: `Als Hausgeld sind ${formatCents(feesPaid)} erfasst, ${formatCents(-feesOutstanding)} mehr als laut Wirtschaftsplan (${formatCents(figures.feesDue)}). Prüfe, ob eine Sonderumlage oder eine Zahlung eines anderen Jahres dabei ist.`
		});
	}
	if (allocableMissing > TOLERANCE) {
		findings.push({
			code: 'allocable',
			message: `Von den umlagefähigen Kosten (${formatCents(figures.allocableCosts)}) sind ${formatCents(allocableRecorded)} als Belege mit den Zahlen der WEG erfasst; ${formatCents(allocableMissing)} fehlen noch in der Nebenkostenabrechnung.`
		});
	} else if (allocableMissing < -TOLERANCE) {
		findings.push({
			code: 'allocable',
			message: `Als Belege mit den Zahlen der WEG sind ${formatCents(allocableRecorded)} erfasst, ${formatCents(-allocableMissing)} mehr als die umlagefähigen Kosten laut Hausgeldabrechnung (${formatCents(figures.allocableCosts)}). Prüfe, ob ein Beleg doppelt oder nicht umlagefähig ist.`
		});
	}

	return {
		costsTotal,
		computedBalance,
		balanceDifference,
		feesPaid,
		feesOutstanding,
		settlement: costsTotal - feesPaid,
		allocableRecorded,
		allocableMissing,
		findings
	};
}

/** `Nachzahlung 120,00 €` or `Guthaben 80,00 €`. */
export function balanceText(balance: number): string {
	if (balance === 0) return 'ausgeglichen';
	return `${balance > 0 ? 'Nachzahlung' : 'Guthaben'} ${formatCents(Math.abs(balance))}`;
}

const signed = balanceText;
