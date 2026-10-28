import { error, fail, redirect } from '@sveltejs/kit';
import { isIsoDate, today } from '#lib/dates.ts';
import { depositInstalments } from '#lib/domain/deposit.ts';
import { MAX_DEDUCTIONS } from '#lib/domain/deposit-settlement.ts';
import { parseDepositMovement, parseSettlement } from '#lib/forms/deposits.ts';
import {
	arrearsOn,
	createSettlement,
	deleteSettlement,
	getSettlement
} from '#lib/server/deposit-settlements.ts';
import {
	addDepositMovement,
	deleteDepositMovement,
	depositSummary,
	listDepositMovements,
	updateDepositMovement
} from '#lib/server/deposits.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// The "Kaution" tab: the agreed deposit, its movements and what is still open, and once the lease
// has ended the Kautionsabrechnung. The lease comes from the layout.
// ?bearbeiten=<id> opens a movement in the edit dialog, ?datum=<date> sets the settlement date.
export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const accountId = requireAccount(locals);
	const { lease } = await parent();
	const day = today();
	const [movements, settlement] = await Promise.all([
		listDepositMovements(locals.db, accountId, lease.id),
		getSettlement(locals.db, accountId, lease.id)
	]);
	const summary = depositSummary(movements, lease.securityDeposit);
	// § 551 Abs. 2 BGB: the instalments are shown until the tenant has paid the deposit in.
	const instalments =
		summary.received < lease.securityDeposit
			? depositInstalments({ ...lease, state: lease.property.state })
			: [];
	// One assigned from a bank transaction is changed under Bank, one of the settlement goes with it.
	const editing = movements.find(
		(movement) =>
			movement.id === url.searchParams.get('bearbeiten') &&
			!movement.bankTransactionId &&
			!movement.settlementId
	);
	// The settlement form, once the lease has ended: the arrears it may offset are those on the
	// chosen date, today unless one between the end and today is asked for.
	const settleable = !settlement && lease.endDate !== null && lease.endDate <= day;
	const asked = url.searchParams.get('datum') ?? '';
	const settleDate =
		settleable && isIsoDate(asked) && asked >= lease.endDate! && asked <= day ? asked : day;
	const arrears = settleable
		? Math.max(0, await arrearsOn(locals.db, accountId, lease.id, settleDate))
		: 0;
	return {
		movements,
		editing: editing ?? null,
		summary,
		instalments,
		settlement: settlement ?? null,
		settleable,
		arrears,
		settleDate,
		maxDeductions: MAX_DEDUCTIONS,
		today: day
	};
};

const missing = 'Diese Bewegung gibt es nicht.';
const fromSettlement =
	'Diese Bewegung gehört zur Kautionsabrechnung. Lösche die Abrechnung, dann verschwindet sie hier.';
const fromBank =
	'Diese Bewegung stammt aus einem Umsatz. Hebe die Zuordnung unter Bank auf, dann verschwindet sie hier.';

export const actions: Actions = {
	add: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const result = parseDepositMovement(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const id = await addDepositMovement(locals.db, context, { leaseId: params.id, ...result.data });
		if (!id) error(404, 'Diesen Mietvertrag gibt es nicht.');
		return { added: true };
	},

	update: async ({ request, locals, params }) => {
		const form = await request.formData();
		const movementId = String(form.get('movementId') ?? '');
		const result = parseDepositMovement(form);
		if (!result.ok) return fail(400, { edit: true, errors: result.errors, values: result.values });
		const outcome = await updateDepositMovement(locals.db, auditContext(locals), movementId, {
			leaseId: params.id,
			...result.data
		});
		if (outcome === 'missing') return fail(404, { message: missing });
		if (outcome === 'from-bank') return fail(400, { message: fromBank });
		if (outcome === 'from-settlement') return fail(400, { message: fromSettlement });
		redirect(303, `/vertraege/${params.id}/kaution`);
	},

	delete: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const movementId = (await request.formData()).get('movementId');
		if (typeof movementId !== 'string') return fail(400, { message: 'Ungültige Auswahl.' });
		const outcome = await deleteDepositMovement(locals.db, context, params.id, movementId);
		if (outcome === 'missing') return fail(404, { message: missing });
		if (outcome === 'from-bank') return fail(400, { message: fromBank });
		if (outcome === 'from-settlement') return fail(400, { message: fromSettlement });
		redirect(303, `/vertraege/${params.id}/kaution`);
	},

	settle: async ({ request, locals, params }) => {
		const form = await request.formData();
		const result = parseSettlement(form);
		if (!result.ok) {
			return fail(400, { settle: true, errors: result.errors, values: result.values });
		}
		const created = await createSettlement(locals.db, auditContext(locals), params.id, result.data);
		if (!created) error(404, 'Diesen Mietvertrag gibt es nicht.');
		if (!created.ok) {
			return fail(400, {
				settle: true,
				message: created.message,
				// The form as sent, so a refusal keeps what was typed.
				values: Object.fromEntries(
					[...form].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
				),
				arrears: created.arrears
			});
		}
		return { settled: true };
	},

	deleteSettlement: async ({ locals, params }) => {
		if (!(await deleteSettlement(locals.db, auditContext(locals), params.id))) {
			return fail(404, { message: 'Diese Abrechnung gibt es nicht.' });
		}
		redirect(303, `/vertraege/${params.id}/kaution`);
	}
};
