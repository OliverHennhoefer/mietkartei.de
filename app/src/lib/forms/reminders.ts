import type { IsoDate } from '../dates';
import type { ReminderLevel } from '../server/db/schema';
import { FormParser, type ParseResult } from './fields';

// The form that writes a Zahlungserinnerung or Mahnung. The lease comes from the route.

export type ReminderForm = { level: ReminderLevel; date: IsoDate; paymentDeadline: IsoDate };

const levels = ['1', '2', '3'] as const;

export function parseReminder(form: FormData): ParseResult<ReminderForm> {
	const parser = new FormParser<ReminderForm>(form);
	const level = parser.oneOf('level', levels);
	const date = parser.date('date');
	const paymentDeadline = parser.date('paymentDeadline');
	if (date && paymentDeadline && paymentDeadline <= date) {
		parser.fail('paymentDeadline', 'Die Zahlungsfrist muss nach dem Datum des Schreibens liegen.');
	}
	return parser.result(() => ({
		level: Number(level) as ReminderLevel,
		date: date!,
		paymentDeadline: paymentDeadline!
	}));
}
