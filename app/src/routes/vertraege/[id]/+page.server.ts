import { error, fail, redirect } from '@sveltejs/kit';
import { formatDate, today } from '#lib/dates.ts';
import { leaseEndDeadlines, proposedEndDate } from '#lib/domain/lease-end.ts';
import { parseLeaseEnd, parseLeasePersons } from '#lib/forms/leases.ts';
import { depositSummary, listDepositMovements } from '#lib/server/deposits.ts';
import {
	addLeasePersons,
	deleteLease,
	deleteLeasePersons,
	endLease,
	getLease,
	listLeasePersons
} from '#lib/server/leases.ts';
import { rentOnDate } from '#lib/server/rents.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// The "Übersicht" tab: the lease as the layout loaded it, plus the current rent and what the
// Kaution tab sums up, and the persons history and the end of the lease, which are edited here.
// A fixed number of queries whatever the lease's size.
export const load: PageServerLoad = async ({ locals, parent }) => {
	const accountId = requireAccount(locals);
	const { lease } = await parent();
	const date = today();
	const [persons, rent, movements] = await Promise.all([
		listLeasePersons(locals.db, accountId, lease.id),
		rentOnDate(locals.db, accountId, lease.id, date),
		listDepositMovements(locals.db, accountId, lease.id)
	]);
	const current = rent ?? lease.currentRent;
	return {
		persons,
		currentRent: {
			baseRent: current.baseRent,
			operatingCostPrepayment: current.operatingCostPrepayment,
			heatingCostPrepayment: current.heatingCostPrepayment,
			total: current.baseRent + current.operatingCostPrepayment + current.heatingCostPrepayment
		},
		deposit: depositSummary(movements, lease.securityDeposit),
		// Prefilled for a tenant's notice received today; the page recomputes the end date when the
		// receipt date or the party changes, and the action checks it.
		endProposal: {
			terminatedAt: date,
			terminatedBy: 'tenant' as const,
			endDate: proposedEndDate({
				kind: lease.kind,
				startDate: lease.startDate,
				terminatedAt: date,
				terminatedBy: 'tenant'
			})
		},
		deadlines: lease.endDate ? leaseEndDeadlines(lease.endDate) : null
	};
};

const notFound = () => error(404, 'Diesen Mietvertrag gibt es nicht.');

/** One shape for every failed form on this page, so the page can tell them apart by `which`. */
type FormFailure = {
	which: 'persons' | 'end';
	errors: Partial<Record<string, string>>;
	values: Record<string, string>;
};
const refuse = (failure: FormFailure) => fail(400, failure);

export const actions: Actions = {
	addPersons: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const result = parseLeasePersons(await request.formData());
		if (!result.ok) {
			return refuse({
				which: 'persons',
				errors: result.errors,
				values: result.values
			});
		}
		const outcome = await addLeasePersons(locals.db, context, params.id, result.data);
		if (outcome.ok) return { which: 'persons' as const };
		if (outcome.reason === 'missing') notFound();
		return refuse({
			which: 'persons',
			errors: {
				validFrom:
					outcome.reason === 'duplicate'
						? 'Für dieses Datum gibt es schon einen Eintrag.'
						: 'Das Datum liegt vor dem Vertragsbeginn.'
			},
			values: { validFrom: result.data.validFrom, persons: String(result.data.persons) }
		});
	},

	deletePersons: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const rowId = (await request.formData()).get('rowId');
		if (typeof rowId !== 'string') return fail(400, { message: 'Ungültige Auswahl.' });
		const outcome = await deleteLeasePersons(locals.db, context, params.id, rowId);
		if (outcome === 'missing') notFound();
		if (outcome === 'initial') {
			return fail(400, {
				message:
					'Der erste Eintrag gehört zum Vertragsbeginn und bleibt; die Personenzahl bei Einzug änderst du unter „Bearbeiten“.'
			});
		}
		return { which: 'persons' as const };
	},

	end: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const form = await request.formData();
		const result = parseLeaseEnd(form);
		if (!result.ok) {
			return refuse({
				which: 'end',
				errors: result.errors,
				values: result.values
			});
		}
		const values = Object.fromEntries(
			[...form].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
		);
		const lease = await getLease(locals.db, context.accountId, params.id);
		if (!lease) return notFound();
		// The notice period of § 573c / § 580a BGB; an earlier end needs an agreement.
		const earliest = proposedEndDate({
			kind: lease.kind,
			startDate: lease.startDate,
			terminatedAt: result.data.terminatedAt,
			terminatedBy: result.data.terminatedBy
		});
		if (result.data.endDate < earliest && !result.data.earlyEndAgreed) {
			const law = lease.kind === 'commercial' ? '§ 580a Abs. 2 BGB' : '§ 573c BGB';
			return refuse({
				which: 'end',
				errors: {
					endDate: `Nach ${law} endet der Vertrag bei dieser Kündigung frühestens am ${formatDate(earliest)}. Ein früheres Ende gilt nur, wenn du es mit der anderen Seite vereinbart hast; dann setze den Haken „Früheres Ende vereinbart“.`
				},
				values
			});
		}
		const outcome = await endLease(locals.db, context, params.id, result.data);
		if (outcome === 'missing') notFound();
		if (outcome === 'before-start') {
			return refuse({
				which: 'end',
				errors: { endDate: 'Das Vertragsende liegt vor dem Vertragsbeginn.' },
				values
			});
		}
		return { which: 'end' as const };
	},

	delete: async ({ locals, params }) => {
		const context = auditContext(locals);
		if (!(await getLease(locals.db, context.accountId, params.id))) notFound();
		const outcome = await deleteLease(locals.db, context, params.id);
		if (outcome === 'missing') notFound();
		if (outcome === 'in-use') {
			return fail(400, {
				message:
					'Auf diesem Mietvertrag wurden schon Kautionsbewegungen gebucht; er lässt sich nicht löschen, damit die Historie bleibt. Beende den Vertrag stattdessen mit „Vertrag beenden“.'
			});
		}
		redirect(303, '/vertraege');
	}
};
