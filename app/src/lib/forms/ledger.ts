import {
	addMonthsToMonth,
	isIsoMonth,
	monthOf,
	today,
	type IsoDate,
	type IsoMonth
} from '../dates';
import { FormParser, type ParseResult } from './fields';

// Forms of the ledger pages: booking a payment, posting an adjustment, choosing the months shown.
// Which lease the posting belongs to comes from the route, never from the form.

// The forms ask for the side of the booking and an amount without a sign, like Soll and Haben on
// paper: nobody has to know which sign a refund or a credit takes. The stored amounts keep their
// sign.

export const paymentSides = ['received', 'refund'] as const;
export const adjustmentSides = ['claim', 'credit'] as const;

export type PaymentForm = {
	date: IsoDate;
	/** Positive = received from the tenant, negative = refunded. Never zero. */
	amount: number;
	note: string | null;
	/** Received (Haben) or refunded to the tenant (Soll); null for a signed amount from an import. */
	side: (typeof paymentSides)[number] | null;
};

const largest = 100_000_000_00;

/** An amount without a sign, negated for the given side; refuses zero. */
function sidedAmount<T extends { amount: unknown }>(
	parser: FormParser<T>,
	negative: boolean
): number | null {
	const name = 'amount' as keyof T & string;
	const amount = parser.money(name);
	if (amount === 0) parser.fail(name, 'Der Betrag darf nicht 0 sein.');
	return amount === null ? null : negative ? -amount : amount;
}

/**
 * A payment from the Mietkonto form with its side and a positive amount. Without a side (the
 * import of a spreadsheet) the amount carries the sign: negative for a refund.
 */
export function parsePayment(form: FormData): ParseResult<PaymentForm> {
	const parser = new FormParser<PaymentForm>(form);
	const date = parser.date('date');
	const side = parser.oneOf('side', paymentSides, { required: false });
	let amount: number | null;
	if (side) amount = sidedAmount(parser, side === 'refund');
	else {
		amount = parser.money('amount', { min: -largest });
		if (amount === 0) parser.fail('amount', 'Der Betrag darf nicht 0 sein.');
	}
	const note = parser.optionalText('note');
	return parser.result(() => ({ date: date!, amount: amount!, note, side }));
}

export type AdjustmentForm = {
	date: IsoDate;
	/** Positive = Forderung (the tenant owes more), negative = Gutschrift. Never zero. */
	amount: number;
	note: string;
	/** Forderung an den Mieter (Soll) or Gutschrift für den Mieter (Haben). */
	side: (typeof adjustmentSides)[number];
};

export function parseAdjustment(form: FormData): ParseResult<AdjustmentForm> {
	const parser = new FormParser<AdjustmentForm>(form);
	const date = parser.date('date');
	const side = parser.oneOf('side', adjustmentSides);
	const amount = sidedAmount(parser, side === 'credit');
	// A correction without a reason is a riddle a year later; "Anfangssaldo" is reason enough.
	const note = parser.text('note');
	return parser.result(() => ({ date: date!, amount: amount!, note, side: side! }));
}

export type LedgerRange = { from: IsoMonth; to: IsoMonth };

/**
 * The months shown on the ledger page, from the `from` and `to` query parameters. Without them
 * (or with ones that are not months) the last twelve months including the current one; when
 * they are the wrong way round they are swapped.
 */
export function ledgerRange(params: URLSearchParams, current: IsoDate = today()): LedgerRange {
	const currentMonth = monthOf(current);
	const from = params.get('from') ?? '';
	const to = params.get('to') ?? '';
	if (!isIsoMonth(from) || !isIsoMonth(to)) {
		return { from: addMonthsToMonth(currentMonth, -11), to: currentMonth };
	}
	return from <= to ? { from, to } : { from: to, to: from };
}
