import { error, fail } from '@sveltejs/kit';
import { firstOfMonth, lastOfMonth, monthOf, today } from '#lib/dates.ts';
import { defaultPaymentDeadline } from '#lib/domain/reminders.ts';
import { total } from '#lib/domain/rents.ts';
import { balanceSentence, ledgerRange, parseAdjustment, parsePayment } from '#lib/forms/ledger.ts';
import { parseReminder } from '#lib/forms/reminders.ts';
import { landlordAddress } from '#lib/server/accounts.ts';
import {
	createPayment,
	deleteCharge,
	deletePayment,
	listLedger,
	listLedgerLineDetails,
	postCharge,
	type LedgerLine
} from '#lib/server/ledger.ts';
import { createReminder, deleteReminder, reminderState } from '#lib/server/reminders.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// The Mietkonto tab of a lease: the ledger lines of the chosen months, a form to book a payment,
// one to post a correction and the Zahlungserinnerungen and Mahnungen with the form for the next. The lease comes from the layout, which answers 404 for a lease of
// another account; the actions run without it, so the ledger module checks the account and they
// only ever post to params.id.

export type LedgerRow = LedgerLine & {
	/** A manual payment or an adjustment: the landlord may delete it here. */
	deletable: boolean;
	/** A payment assigned from a bank transaction: undone under /bank, not here. */
	fromBank: boolean;
	/** The bank transaction of such a payment, for the link to it on /bank. */
	bankTransactionId: string | null;
};

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const accountId = requireAccount(locals);
	const { lease } = await parent();
	const range = ledgerRange(url.searchParams);
	const from = firstOfMonth(range.from);
	const to = lastOfMonth(range.to);

	// One ledger read from `from` on, without an upper bound, so the balance is the lease's real
	// one; the lines after `to` are dropped here. listLedger syncs the rent charges first, so the
	// details are read after it.
	const ledger = await listLedger(locals.db, accountId, lease.id, { from });
	const currentDate = today();
	const [details, reminders, landlord] = await Promise.all([
		listLedgerLineDetails(locals.db, accountId, lease.id),
		reminderState(locals.db, accountId, lease.id, currentDate),
		landlordAddress(locals.db, accountId)
	]);

	const shown = ledger.lines.filter((line) => line.date <= to);
	const charged = shown.reduce(
		(sum, line) => (line.kind === 'charge' ? sum + line.amount : sum),
		0
	);
	const paid = shown.reduce((sum, line) => (line.kind === 'payment' ? sum + line.amount : sum), 0);
	const carried = ledger.balance - ledger.charged + ledger.paid;
	const rows: LedgerRow[] = shown.map((line) => {
		const detail = details[line.id];
		const fromBank = detail?.kind === 'payment' && detail.source === 'bank';
		const deletable =
			(detail?.kind === 'payment' && detail.source === 'manual') ||
			(detail?.kind === 'charge' && detail.chargeKind === 'adjustment');
		const bankTransactionId =
			detail?.kind === 'payment' && fromBank ? detail.bankTransactionId : null;
		return { ...line, deletable, fromBank, bankTransactionId };
	});

	return {
		range,
		rows,
		charged,
		paid,
		/** The balance at the end of the months shown. */
		windowBalance: carried + charged - paid,
		/** The lease's balance over everything booked. */
		balance: ledger.balance,
		balanceText: balanceSentence(ledger.balance),
		today: currentDate,
		paymentDefault: ledger.balance > 0 ? ledger.balance : total(lease.currentRent),
		reminders,
		paymentDeadlineDefault: defaultPaymentDeadline(currentDate),
		landlordComplete: landlord.complete
	};
};

const bankPaymentMessage =
	'Diese Zahlung stammt aus einem Umsatz. Hebe die Zuordnung unter Bank beim Umsatz auf (Status „Zugeordnet“), dann verschwindet sie auch hier.';
const chargeMessage =
	'Nur Korrekturen lassen sich hier löschen. Mieten folgen aus dem Vertrag, Abrechnungen und CO₂-Erstattungen werden dort zurückgenommen, wo sie gebucht wurden.';

function idOf(form: FormData): string {
	const value = form.get('id');
	return typeof value === 'string' && value.length <= 64 ? value : '';
}

export const actions: Actions = {
	payment: async ({ request, locals, params }) => {
		const result = parsePayment(await request.formData());
		if (!result.ok) {
			return fail(400, { form: 'payment' as const, errors: result.errors, values: result.values });
		}
		const id = await createPayment(locals.db, auditContext(locals), {
			leaseId: params.id,
			date: result.data.date,
			amount: result.data.amount,
			source: 'manual',
			note: result.data.note
		});
		if (!id) error(404, 'Diesen Mietvertrag gibt es nicht.');
		return { booked: 'payment' as const };
	},

	adjustment: async ({ request, locals, params }) => {
		const result = parseAdjustment(await request.formData());
		if (!result.ok) {
			return fail(400, {
				form: 'adjustment' as const,
				errors: result.errors,
				values: result.values
			});
		}
		const id = await postCharge(locals.db, auditContext(locals), {
			leaseId: params.id,
			kind: 'adjustment',
			period: monthOf(result.data.date),
			dueDate: result.data.date,
			amount: result.data.amount,
			note: result.data.note
		});
		if (!id) error(404, 'Diesen Mietvertrag gibt es nicht.');
		return { booked: 'adjustment' as const };
	},

	deletePayment: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const id = idOf(await request.formData());
		const detail = (await listLedgerLineDetails(locals.db, context.accountId, params.id))[id];
		if (!detail || detail.kind !== 'payment') {
			return fail(400, { message: 'Diese Zahlung gibt es nicht mehr.' });
		}
		if (detail.source === 'bank') return fail(400, { message: bankPaymentMessage });
		if (!(await deletePayment(locals.db, context, id))) {
			return fail(400, { message: 'Diese Zahlung gibt es nicht mehr.' });
		}
		return { deleted: 'payment' as const };
	},

	deleteCharge: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const id = idOf(await request.formData());
		const detail = (await listLedgerLineDetails(locals.db, context.accountId, params.id))[id];
		if (!detail || detail.kind !== 'charge') {
			return fail(400, { message: 'Diese Buchung gibt es nicht mehr.' });
		}
		if (!(await deleteCharge(locals.db, context, id))) return fail(400, { message: chargeMessage });
		return { deleted: 'adjustment' as const };
	},

	reminder: async ({ request, locals, params }) => {
		const result = parseReminder(await request.formData());
		if (!result.ok) {
			return fail(400, { form: 'reminder' as const, errors: result.errors, values: result.values });
		}
		const created = await createReminder(locals.db, auditContext(locals), params.id, result.data);
		if (!created) error(404, 'Diesen Mietvertrag gibt es nicht.');
		if (!created.ok) return fail(400, { message: created.message });
		return { reminderId: created.id };
	},

	deleteReminder: async ({ request, locals, params }) => {
		const id = idOf(await request.formData());
		if (!(await deleteReminder(locals.db, auditContext(locals), params.id, id))) {
			return fail(400, { message: 'Dieses Schreiben gibt es nicht mehr.' });
		}
		return { deleted: 'reminder' as const };
	}
};
