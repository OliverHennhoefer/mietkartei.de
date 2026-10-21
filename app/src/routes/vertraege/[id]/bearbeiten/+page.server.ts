import { error, fail, redirect } from '@sveltejs/kit';
import { formatDate } from '#lib/dates.ts';
import { depositWarning, parseLeaseEdit } from '#lib/forms/leases.ts';
import { formatCentsPlain, parseCents } from '#lib/money.ts';
import { getLease, leaseInputOf, updateLease } from '#lib/server/leases.ts';
import { ensureCharges } from '#lib/server/ledger.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { listTenants } from '#lib/server/tenants.ts';
import type { Actions, PageServerLoad } from './$types';

// Edits everything but the units (end the lease and start a new one), including the amounts,
// deposit and persons at the start of the lease (later changes: the Miethöhe tab and the persons
// history). The lease itself comes from the layout.
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
		baseRent: formatCentsPlain(input.baseRent),
		operatingCostPrepayment: formatCentsPlain(input.operatingCostPrepayment),
		heatingCostPrepayment: formatCentsPlain(input.heatingCostPrepayment),
		securityDeposit: formatCentsPlain(input.securityDeposit),
		persons: String(input.persons),
		ledgerStart: input.ledgerStart ?? '',
		indexBaseMonth: input.indexBaseMonth ?? '',
		indexBaseValue: input.indexBaseValue === null ? '' : String(input.indexBaseValue),
		indexBaseYear: input.indexBaseYear,
		terminatedAt: input.terminatedAt ?? '',
		terminatedBy: input.terminatedBy ?? '',
		notes: input.notes ?? ''
	};
	return { tenants, defaults, depositWarning: depositWarning(input) };
};

/** The § 551 hint for the values as typed. */
function warningFor(
	values: Record<string, string>,
	kind: 'residential' | 'commercial' | 'parking'
) {
	const baseRent = parseCents(values.baseRent ?? '');
	const securityDeposit = parseCents(values.securityDeposit ?? '');
	if (baseRent === undefined || securityDeposit === undefined) return undefined;
	return depositWarning({ kind, baseRent, securityDeposit });
}

function kindOf(value: string | undefined, fallback: 'residential' | 'commercial' | 'parking') {
	return value === 'residential' || value === 'commercial' || value === 'parking'
		? value
		: fallback;
}

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const lease = await getLease(locals.db, context.accountId, params.id);
		if (!lease) error(404, 'Diesen Mietvertrag gibt es nicht.');
		const form = await request.formData();
		const result = parseLeaseEdit(form, leaseInputOf(lease));
		if (!result.ok) {
			const values = result.values;
			return fail(400, {
				errors: result.errors,
				values,
				depositWarning: warningFor(values, kindOf(values.kind, lease.kind))
			});
		}
		const outcome = await updateLease(locals.db, context, lease.id, result.data);
		if (!outcome.ok) {
			if (outcome.reason === 'missing') error(404, 'Diesen Mietvertrag gibt es nicht.');
			const values = Object.fromEntries(
				[...form].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
			);
			values.tenantIds = form
				.getAll('tenantIds')
				.filter((id) => typeof id === 'string')
				.join(',');
			const errors: Partial<Record<string, string>> =
				outcome.reason === 'start-after-changes'
					? {
							startDate: `Am ${formatDate(outcome.date ?? result.data.startDate)} beginnt schon eine spätere Mietänderung oder ein Eintrag im Personenstand. Der Beginn muss davor liegen; lösche oder verschiebe die späteren Einträge zuerst.`
						}
					: outcome.reason === 'unknown-unit'
						? { unitId: 'Eine der Einheiten gibt es nicht.' }
						: { tenantIds: 'Einen der Mieter gibt es nicht.' };
			return fail(400, { errors, values, depositWarning: depositWarning(result.data) });
		}
		// A new start, end, due day or ledger start moves the months on the ledger.
		await ensureCharges(locals.db, context.accountId, [lease.id]);
		redirect(303, `/vertraege/${lease.id}`);
	}
};
