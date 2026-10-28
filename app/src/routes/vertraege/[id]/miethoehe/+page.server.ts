import { error, fail, redirect } from '@sveltejs/kit';
import { addMonthsToMonth, firstOfMonth, monthOf, today } from '#lib/dates.ts';
import { comparativeSituation } from '#lib/domain/comparative-rent.ts';
import { effectiveFrom, indexSituation, nextGraduatedStepAllowed } from '#lib/domain/index-rent.ts';
import { rentOn } from '#lib/domain/rents.ts';
import {
	parseApproval,
	parseComparativeDemand,
	parseConsent,
	parseGraduatedStep,
	parseManualChange
} from '#lib/forms/rent.ts';
import { landlordAddress } from '#lib/server/accounts.ts';
import { currentIndexValues } from '#lib/server/consumer-price-index.ts';
import { getLease, type LeaseSummary } from '#lib/server/leases.ts';
import {
	addGraduatedStep,
	approveChange,
	demandComparativeIncrease,
	manualChange,
	proposeIndexChange,
	recordConsent,
	removeChange
} from '#lib/server/rent-adjustments.ts';
import { listRentChanges } from '#lib/server/rents.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// The "Miethöhe" tab: the rent history with manual changes, Staffel steps, index proposals and
// § 558 demands.
// The lease comes from the layout; every action loads it again, so an id of another account
// answers 404 before anything is written.

export const load: PageServerLoad = async ({ locals, params, parent, url }) => {
	const accountId = requireAccount(locals);
	const { lease } = await parent();
	const [changes, values, landlord] = await Promise.all([
		listRentChanges(locals.db, accountId, params.id),
		currentIndexValues(locals.db),
		landlordAddress(locals.db, accountId)
	]);
	const day = today();
	// ?prepayment=<cents>&heating=<cents> come from an approved statement ("Vorauszahlung
	// anpassen"): the suggested operating and heating cost prepayments, each optional.
	const cents = (name: string) => {
		const value = url.searchParams.get(name);
		return value && /^\d{1,12}$/.test(value) ? Number(value) : null;
	};
	const prepaymentCents = cents('prepayment');
	const heatingCents = cents('heating');
	const fromStatement = prepaymentCents !== null || heatingCents !== null;
	// The change form starts from the rent valid on its default date, so a Staffel step or index
	// change between today and that date is not undone by today's amounts.
	const changeFrom = fromStatement
		? effectiveFrom(day)
		: firstOfMonth(addMonthsToMonth(monthOf(day), 1));
	const rentThen = rentOn(changes, changeFrom) ?? lease.currentRent;
	return {
		changes,
		today: day,
		situation: indexSituation(lease, changes, values, day),
		// A § 558 demand that reaches the tenant today; the form recomputes for another day.
		comparative: comparativeSituation({ ...lease, floorArea: lease.unit.floorArea }, changes, day),
		nextStepAllowed:
			lease.rentModel === 'graduated' ? nextGraduatedStepAllowed(changes) : undefined,
		prepayment: prepaymentCents,
		heatingPrepayment: heatingCents,
		/**
		 * The default first day of the change: the first of next month, the month after next for
		 * a § 560 adjustment.
		 */
		changeFrom,
		/** The amounts valid on changeFrom, to prefill the change form. */
		changeDefaults: {
			baseRent: rentThen.baseRent,
			operatingCostPrepayment: prepaymentCents ?? rentThen.operatingCostPrepayment,
			heatingCostPrepayment: heatingCents ?? rentThen.heatingCostPrepayment
		},
		landlordComplete: landlord.complete
	};
};

async function requireLease(locals: App.Locals, leaseId: string): Promise<LeaseSummary> {
	const lease = await getLease(locals.db, requireAccount(locals), leaseId);
	if (!lease) error(404, 'Diesen Mietvertrag gibt es nicht.');
	return lease;
}

/** The string fields of a form, to re-render it after a refusal. */
function stringValues(form: FormData): Record<string, string> {
	const values: Record<string, string> = {};
	for (const [name, value] of form.entries()) if (typeof value === 'string') values[name] = value;
	return values;
}

function changeIdOf(form: FormData): string {
	const value = form.get('changeId');
	if (typeof value !== 'string' || !value || value.length > 64)
		error(404, 'Diese Mietänderung gibt es nicht.');
	return value;
}

export const actions: Actions = {
	change: async ({ request, locals, params }) => {
		const lease = await requireLease(locals, params.id);
		const form = await request.formData();
		const changes = await listRentChanges(locals.db, requireAccount(locals), lease.id);
		const result = parseManualChange(form, {
			baseRentOn: (validFrom) => rentOn(changes, validFrom)?.baseRent,
			// § 557a Abs. 2 / § 557b Abs. 2 BGB exclude § 558 increases on residential leases.
			noteRequiredOnBaseRentChange: lease.kind === 'residential' && lease.rentModel !== 'fixed'
		});
		if (!result.ok) {
			return fail(400, { source: 'change', errors: result.errors, values: result.values });
		}
		const outcome = await manualChange(locals.db, auditContext(locals), lease.id, result.data);
		if (!outcome) error(404, 'Diesen Mietvertrag gibt es nicht.');
		if (!outcome.ok) {
			return fail(400, { source: 'change', refusal: outcome.message, values: stringValues(form) });
		}
		return { source: 'change', saved: true };
	},

	step: async ({ request, locals, params }) => {
		const lease = await requireLease(locals, params.id);
		const form = await request.formData();
		const result = parseGraduatedStep(form);
		if (!result.ok) {
			return fail(400, { source: 'step', errors: result.errors, values: result.values });
		}
		const outcome = await addGraduatedStep(locals.db, auditContext(locals), lease.id, result.data);
		if (!outcome) error(404, 'Diesen Mietvertrag gibt es nicht.');
		if (!outcome.ok) {
			return fail(400, { source: 'step', refusal: outcome.message, values: stringValues(form) });
		}
		return { source: 'step', saved: true };
	},

	propose: async ({ locals, params }) => {
		const lease = await requireLease(locals, params.id);
		const outcome = await proposeIndexChange(locals.db, auditContext(locals), lease.id);
		if (!outcome) error(404, 'Diesen Mietvertrag gibt es nicht.');
		if (!outcome.ok) return fail(400, { source: 'propose', refusal: outcome.message });
		return { source: 'propose', saved: true };
	},

	approve: async ({ request, locals, params }) => {
		const lease = await requireLease(locals, params.id);
		const form = await request.formData();
		const changeId = changeIdOf(form);
		const result = parseApproval(form, { editableValidFrom: lease.kind !== 'residential' });
		if (!result.ok) {
			return fail(400, { source: 'approve', errors: result.errors, values: result.values });
		}
		const outcome = await approveChange(
			locals.db,
			auditContext(locals),
			lease.id,
			changeId,
			result.data
		);
		if (!outcome) error(404, 'Diese Mietänderung gibt es nicht.');
		if (!outcome.ok) {
			return fail(400, { source: 'approve', refusal: outcome.message, values: stringValues(form) });
		}
		return { source: 'approve', saved: true };
	},

	demand: async ({ request, locals, params }) => {
		const lease = await requireLease(locals, params.id);
		const form = await request.formData();
		const result = parseComparativeDemand(form);
		if (!result.ok) {
			return fail(400, { source: 'demand', errors: result.errors, values: result.values });
		}
		const outcome = await demandComparativeIncrease(
			locals.db,
			auditContext(locals),
			lease.id,
			result.data
		);
		if (!outcome) error(404, 'Diesen Mietvertrag gibt es nicht.');
		if (!outcome.ok) {
			return fail(400, { source: 'demand', refusal: outcome.message, values: stringValues(form) });
		}
		return { source: 'demand', saved: true };
	},

	consent: async ({ request, locals, params }) => {
		const lease = await requireLease(locals, params.id);
		const form = await request.formData();
		const changeId = changeIdOf(form);
		const result = parseConsent(form);
		if (!result.ok) {
			return fail(400, { source: 'consent', errors: result.errors, values: result.values });
		}
		const outcome = await recordConsent(
			locals.db,
			auditContext(locals),
			lease.id,
			changeId,
			result.data
		);
		if (!outcome) error(404, 'Diese Mietänderung gibt es nicht.');
		if (!outcome.ok) {
			return fail(400, { source: 'consent', refusal: outcome.message, values: stringValues(form) });
		}
		return { source: 'consent', saved: true };
	},

	delete: async ({ request, locals, params }) => {
		const lease = await requireLease(locals, params.id);
		const changeId = changeIdOf(await request.formData());
		const outcome = await removeChange(locals.db, auditContext(locals), lease.id, changeId);
		if (!outcome) error(404, 'Diese Mietänderung gibt es nicht.');
		if (!outcome.ok) return fail(400, { source: 'delete', refusal: outcome.message });
		redirect(303, `/vertraege/${params.id}/miethoehe`);
	}
};
