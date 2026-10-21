import { error, fail } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { parseDepositMovement } from '#lib/forms/deposits.ts';
import {
	addDepositMovement,
	deleteDepositMovement,
	depositSummary,
	instalmentDeadlines,
	listDepositMovements
} from '#lib/server/deposits.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// The "Kaution" tab: the agreed deposit, its movements and what is still open. The lease comes
// from the layout.
export const load: PageServerLoad = async ({ locals, parent }) => {
	const accountId = requireAccount(locals);
	const { lease } = await parent();
	const movements = await listDepositMovements(locals.db, accountId, lease.id);
	const summary = depositSummary(movements, lease.securityDeposit);
	// § 551 Abs. 2 BGB: the instalments are shown until the tenant has paid the deposit in.
	const instalments =
		summary.received < lease.securityDeposit
			? await instalmentDeadlines(locals.db, accountId, lease.id)
			: [];
	return { movements, summary, instalments, today: today() };
};

export const actions: Actions = {
	add: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const result = parseDepositMovement(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const id = await addDepositMovement(locals.db, context, { leaseId: params.id, ...result.data });
		if (!id) error(404, 'Diesen Mietvertrag gibt es nicht.');
		return { added: true };
	},

	delete: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const movementId = (await request.formData()).get('movementId');
		if (typeof movementId !== 'string') return fail(400, { message: 'Ungültige Auswahl.' });
		const outcome = await deleteDepositMovement(locals.db, context, params.id, movementId);
		if (outcome === 'missing') return fail(404, { message: 'Diese Bewegung gibt es nicht.' });
		if (outcome === 'from-bank') {
			return fail(400, {
				message:
					'Diese Bewegung stammt aus einem Umsatz. Hebe die Zuordnung unter Bank auf, dann verschwindet sie hier.'
			});
		}
		return { deleted: true };
	}
};
