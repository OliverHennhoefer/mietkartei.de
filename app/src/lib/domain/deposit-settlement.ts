import { formatDate, type IsoDate } from '../dates';
import { formatCents } from '../money';
import { greeting, type LetterTenant } from './index-rent';

// Kautionsabrechnung: after the lease ended, the landlord settles the deposit. Interest up to the
// day is added (§ 551 Abs. 3 BGB), Einbehalte for damage or a Betriebskostenabrechnung still to
// come are deducted with their reason, arrears on the rent ledger may be offset, and the rest is
// paid back. Pure, so the form's preview and the stored letter compute the same.

export const MAX_DEDUCTIONS = 8;

export type Deduction = { label: string; amount: number };

export type SettlementInput = {
	date: IsoDate;
	/** Interest credited on the day of the settlement, on top of interest already booked. */
	interest: number;
	deductions: Deduction[];
	/** Whether arrears on the rent ledger are taken from the deposit. */
	offsetArrears: boolean;
	/** The arrears the form showed for the date; the offset is refused when they have changed. */
	shownArrears?: number;
};

/** The deposit's movements so far, as positive totals (see depositSummary). */
export type SettlementBalance = {
	received: number;
	interest: number;
	returned: number;
	withheld: number;
	held: number;
};

export type SettlementFigures = SettlementBalance & {
	/** Interest booked with the settlement. */
	newInterest: number;
	/** held + newInterest: what is settled. */
	available: number;
	deductions: Deduction[];
	deducted: number;
	/** Arrears on the rent ledger on the day, and the part taken from the deposit. */
	arrears: number;
	offset: number;
	/** Arrears left on the ledger. */
	remaining: number;
	payout: number;
};

/**
 * The settlement of the deposit: deductions first, then the arrears as far as the deposit
 * reaches, the rest is paid back. A refusal names what does not add up.
 */
export function settlementFigures(
	balance: SettlementBalance,
	input: SettlementInput,
	arrears: number
): { ok: true; figures: SettlementFigures } | { ok: false; message: string } {
	const available = balance.held + input.interest;
	if (available <= 0) return { ok: false, message: 'Es ist keine Kaution mehr abzurechnen.' };
	const deducted = input.deductions.reduce((sum, deduction) => sum + deduction.amount, 0);
	if (deducted > available) {
		return {
			ok: false,
			message: `Die Einbehalte von ${formatCents(deducted)} übersteigen die Kaution von ${formatCents(available)}.`
		};
	}
	const owed = Math.max(0, arrears);
	const offset = input.offsetArrears ? Math.min(owed, available - deducted) : 0;
	return {
		ok: true,
		figures: {
			...balance,
			newInterest: input.interest,
			available,
			deductions: input.deductions,
			deducted,
			arrears: owed,
			offset,
			remaining: owed - offset,
			payout: available - deducted - offset
		}
	};
}

/** The rows of the letter's table: item and amount, deductions as negative amounts. */
export function settlementRows(figures: SettlementFigures): string[][] {
	const minus = (amount: number) => formatCents(-amount);
	const interest = figures.interest + figures.newInterest;
	return [
		['Eingezahlte Kaution', formatCents(figures.received)],
		...(interest > 0 ? [['Zinsen', formatCents(interest)]] : []),
		...(figures.returned > 0 ? [['Bereits zurückgezahlt', minus(figures.returned)]] : []),
		...(figures.withheld > 0 ? [['Bereits einbehalten', minus(figures.withheld)]] : []),
		...figures.deductions.map((deduction) => [
			`Einbehalt: ${deduction.label}`,
			minus(deduction.amount)
		]),
		...(figures.offset > 0 ? [['Verrechnet mit dem Mietrückstand', minus(figures.offset)]] : [])
	];
}

export type SettlementLetterContent = {
	tenants: readonly LetterTenant[];
	unitName: string;
	endDate: IsoDate;
	figures: SettlementFigures;
	/** The landlord's account for remaining arrears. */
	iban: string | null;
};

/**
 * The paragraphs of the letter, separated by blank lines; stored in letterText. The table
 * follows the second paragraph.
 */
export function settlementText(content: SettlementLetterContent): string {
	const { figures } = content;
	const paragraphs = [
		greeting(content.tenants),
		`Ihr Mietverhältnis über ${content.unitName} endete am ${formatDate(content.endDate)}. ` +
			'Über Ihre Mietsicherheit rechnen wir wie folgt ab:',
		figures.payout > 0
			? `Den verbleibenden Betrag von ${formatCents(figures.payout)} überweisen wir Ihnen in den ` +
				'nächsten Tagen. Hat sich Ihre Bankverbindung geändert, teilen Sie uns bitte die neue mit.'
			: 'Damit ist Ihre Kaution vollständig verrechnet; eine Auszahlung ergibt sich nicht.'
	];
	if (figures.deductions.length > 0) {
		paragraphs.push(
			'Die Einbehalte sind oben einzeln mit ihrem Grund aufgeführt. Einen Einbehalt für eine ' +
				'noch ausstehende Betriebskostenabrechnung rechnen wir ab, sobald diese vorliegt.'
		);
	}
	if (figures.offset > 0) {
		const rest =
			figures.remaining > 0
				? `, soweit sie reicht. Danach bleibt ein Rückstand von ${formatCents(figures.remaining)}; ` +
					`bitte überweisen Sie ihn${content.iban ? ` auf unser Konto mit der IBAN ${content.iban}` : ''}.`
				: '.';
		paragraphs.push(
			`Ihren Mietrückstand von ${formatCents(figures.arrears)} haben wir mit der Kaution ` +
				`verrechnet${rest}`
		);
	}
	return paragraphs.join('\n\n');
}
