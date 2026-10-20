import { error, fail, redirect } from '@sveltejs/kit';
import { parseLeaseEdit } from '#lib/forms/leases.ts';
import { getLease, leaseInputOf, updateLease } from '#lib/server/leases.ts';
import { ensureCharges } from '#lib/server/ledger.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { listTenants } from '#lib/server/tenants.ts';
import type { Actions, PageServerLoad } from './$types';

// Edits everything but the units (end the lease and start a new one) and the amounts (the
// Miethöhe tab). The lease itself comes from the layout.
export const load: PageServerLoad = async ({ locals, parent }) => {
	const accountId = requireAccount(locals);
	const { lease } = await parent();
	const tenants = await listTenants(locals.db, accountId);
	const input = leaseInputOf(lease);
	const defaults: Record<string, string> = {
		tenantIds: input.tenantIds.join(','),
		startDate: input.startDate,
		endDate: input.endDate ?? '',
		kind: input.kind,
		rentModel: input.rentModel,
		operatingCostModel: input.operatingCostModel,
		heatingCostModel: input.heatingCostModel,
		rentDueDay: String(input.rentDueDay),
		ledgerStart: input.ledgerStart ?? '',
		indexBaseMonth: input.indexBaseMonth ?? '',
		indexBaseValue: input.indexBaseValue === null ? '' : String(input.indexBaseValue),
		terminatedAt: input.terminatedAt ?? '',
		terminatedBy: input.terminatedBy ?? '',
		notes: input.notes ?? ''
	};
	return { tenants, defaults };
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const lease = await getLease(locals.db, context.accountId, params.id);
		if (!lease) error(404, 'Diesen Mietvertrag gibt es nicht.');
		const form = await request.formData();
		const result = parseLeaseEdit(form, leaseInputOf(lease));
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const outcome = await updateLease(locals.db, context, lease.id, result.data);
		if (!outcome.ok) {
			if (outcome.reason === 'missing') error(404, 'Diesen Mietvertrag gibt es nicht.');
			return fail(400, {
				errors: { tenantIds: 'Einen der Mieter gibt es nicht.' },
				values: Object.fromEntries(
					[...form].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
				)
			});
		}
		// A new start, end or ledger start moves the months on the ledger.
		await ensureCharges(locals.db, context.accountId, [lease.id]);
		redirect(303, `/vertraege/${lease.id}`);
	}
};
