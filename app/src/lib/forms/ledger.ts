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

export type PaymentForm = {
	date: IsoDate;
	/** Positive = received from the tenant, negative = refunded. Never zero. */
	amount: number;
	note: string | null;
};

const largest = 100_000_000_00;

export function parsePayment(form: FormData): ParseResult<PaymentForm> {
	const parser = new FormParser<PaymentForm>(form);
	const date = parser.date('date');
	const amount = parser.money('amount', { min: -largest });
	if (amount === 0) parser.fail('amount', 'Der Betrag darf nicht 0 sein.');
	const note = parser.optionalText('note');
	return parser.result(() => ({ date: date!, amount: amount!, note }));
}

export type AdjustmentForm = {
	date: IsoDate;
	/** Positive = Forderung (the tenant owes more), negative = Gutschrift. Never zero. */
	amount: number;
	note: string;
};

export function parseAdjustment(form: FormData): ParseResult<AdjustmentForm> {
	const parser = new FormParser<AdjustmentForm>(form);
	const date = parser.date('date');
	const amount = parser.money('amount', { min: -largest });
	if (amount === 0) parser.fail('amount', 'Der Betrag darf nicht 0 sein.');
	// A correction without a reason is a riddle a year later; "Anfangssaldo" is reason enough.
	const note = parser.text('note');
	return parser.result(() => ({ date: date!, amount: amount!, note }));
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
