import { error, fail, redirect } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { depositInstalments } from '#lib/domain/deposit.ts';
import { parseDepositMovement } from '#lib/forms/deposits.ts';
import {
	addDepositMovement,
	deleteDepositMovement,
	depositSummary,
	listDepositMovements,
	updateDepositMovement
} from '#lib/server/deposits.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// The "Kaution" tab: the agreed deposit, its movements and what is still open. The lease comes
// from the layout.
// ?bearbeiten=<id> opens a movement in the edit dialog.
export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const accountId = requireAccount(locals);
	const { lease } = await parent();
	const movements = await listDepositMovements(locals.db, accountId, lease.id);
	const summary = depositSummary(movements, lease.securityDeposit);
	// § 551 Abs. 2 BGB: the instalments are shown until the tenant has paid the deposit in.
	const instalments =
		summary.received < lease.securityDeposit
			? depositInstalments({ ...lease, state: lease.property.state })
			: [];
	// One assigned from a bank transaction is changed under Bank.
	const editing = movements.find(
		(movement) => movement.id === url.searchParams.get('bearbeiten') && !movement.bankTransactionId
	);
	return { movements, editing: editing ?? null, summary, instalments, today: today() };
};

const missing = 'Diese Bewegung gibt es nicht.';
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
		redirect(303, `/vertraege/${params.id}/kaution`);
	},

	delete: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const movementId = (await request.formData()).get('movementId');
		if (typeof movementId !== 'string') return fail(400, { message: 'Ungültige Auswahl.' });
		const outcome = await deleteDepositMovement(locals.db, context, params.id, movementId);
		if (outcome === 'missing') return fail(404, { message: missing });
		if (outcome === 'from-bank') return fail(400, { message: fromBank });
		redirect(303, `/vertraege/${params.id}/kaution`);
	}
};
