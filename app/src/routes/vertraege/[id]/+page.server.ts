import { error, fail, redirect } from '@sveltejs/kit';
import { formatDate, today } from '#lib/dates.ts';
import { leaseEndDeadlines, proposedEndDate } from '#lib/domain/lease-end.ts';
import {
	parseLeaseEnd,
	parseLeaseParty,
	parseLeasePartyAdd,
	parseLeasePersons
} from '#lib/forms/leases.ts';
import { deleteLease, leaseDeletion } from '#lib/server/deletion.ts';
import { depositSummary, listDepositMovements } from '#lib/server/deposits.ts';
import {
	addLeaseParty,
	addLeasePersons,
	deleteLeasePersons,
	endLease,
	getLease,
	listLeasePersons,
	updateLeaseParty,
	updateLeasePersons,
	type LeasePartyRefusal
} from '#lib/server/leases.ts';
import { listLedger } from '#lib/server/ledger.ts';
import { rentOnDate } from '#lib/server/rents.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { listTenants } from '#lib/server/tenants.ts';
import type { Actions, PageServerLoad } from './$types';

// The "Übersicht" tab: the lease as the layout loaded it, plus what the other tabs sum up
// (current rent, balance, deposit) and the persons history and the end of the lease, which are
// edited here. A fixed number of queries whatever the lease's size.
export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const accountId = requireAccount(locals);
	const { lease } = await parent();
	const date = today();
	const [persons, rent, ledger, movements, deletion, allTenants] = await Promise.all([
		listLeasePersons(locals.db, accountId, lease.id),
		rentOnDate(locals.db, accountId, lease.id, date),
		listLedger(locals.db, accountId, lease.id),
		listDepositMovements(locals.db, accountId, lease.id),
		leaseDeletion(locals.db, accountId, lease.id),
		listTenants(locals.db, accountId)
	]);
	const current = rent ?? lease.currentRent;
	// ?bearbeiten=<id> opens a later row of the persons history in the edit dialog; the first
	// one belongs to the lease.
	const editing = persons.slice(1).find((row) => row.id === url.searchParams.get('bearbeiten'));
	// ?mieter=<id> opens a party of the lease with the days they joined and left.
	const editingParty = lease.parties.find(
		(party) => party.tenant.id === url.searchParams.get('mieter')
	);
	return {
		persons,
		editing: editing ?? null,
		editingParty: editingParty ?? null,
		/** The tenants who may join the lease: not archived and not on it yet. */
		joinable: allTenants.filter(
			(tenant) => !lease.parties.some((party) => party.tenant.id === tenant.id)
		),
		deletion,
		currentRent: {
			baseRent: current.baseRent,
			operatingCostPrepayment: current.operatingCostPrepayment,
			heatingCostPrepayment: current.heatingCostPrepayment,
			total: current.baseRent + current.operatingCostPrepayment + current.heatingCostPrepayment
		},
		balance: ledger.balance,
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
				terminatedBy: 'tenant',
				state: lease.property.state
			})
		},
		deadlines: lease.endDate ? leaseEndDeadlines(lease.endDate) : null
	};
};

const notFound = () => error(404, 'Diesen Mietvertrag gibt es nicht.');

/** One shape for every failed form on this page, so the page can tell them apart by `which`. */
type FormFailure = {
	which: 'persons' | 'editPersons' | 'end' | 'addParty' | 'editParty';
	errors: Partial<Record<string, string>>;
	values: Record<string, string>;
};
const refuse = (failure: FormFailure) => fail(400, failure);
const initialMessage =
	'Der erste Eintrag gehört zum Vertragsbeginn und bleibt; die Personenzahl bei Einzug änderst du unter „Bearbeiten“.';

/** The field and message of a refused change of the parties. */
function partyError(reason: Exclude<LeasePartyRefusal, 'missing'>): [string, string] {
	switch (reason) {
		case 'unknown-tenant':
			return ['tenantId', 'Diesen Mieter gibt es nicht.'];
		case 'archived':
			return ['tenantId', 'Dieser Mieter ist archiviert.'];
		case 'already-party':
			return ['tenantId', 'Dieser Mieter gehört schon zum Mietvertrag.'];
		case 'too-many':
			return ['tenantId', 'Der Mietvertrag hat schon die größte Zahl an Mietern.'];
		case 'joined-outside':
			return [
				'joinedOn',
				'Der Eintritt muss nach dem Vertragsbeginn und vor dem Vertragsende liegen.'
			];
		case 'left-outside':
			return ['leftOn', 'Der Austritt muss vor dem Vertragsende liegen, nicht vor dem Beginn.'];
		case 'left-before-joined':
			return ['leftOn', 'Der Austritt liegt vor dem Eintritt.'];
		case 'no-party':
			return [
				'leftOn',
				'Dann hätte der Mietvertrag an einem Tag keinen Mieter. Trag zuerst ein, wer an seine Stelle tritt.'
			];
	}
}

export const actions: Actions = {
	addParty: async ({ request, locals, params }) => {
		const result = parseLeasePartyAdd(await request.formData());
		if (!result.ok) {
			return refuse({ which: 'addParty', errors: result.errors, values: result.values });
		}
		const { tenantId, joinedOn } = result.data;
		const outcome = await addLeaseParty(
			locals.db,
			auditContext(locals),
			params.id,
			tenantId,
			joinedOn
		);
		if (outcome.ok) return { which: 'addParty' as const };
		if (outcome.reason === 'missing') notFound();
		const [field, message] = partyError(outcome.reason as Exclude<LeasePartyRefusal, 'missing'>);
		return refuse({
			which: 'addParty',
			errors: { [field === 'leftOn' ? 'joinedOn' : field]: message },
			values: { tenantId, joinedOn: joinedOn ?? '' }
		});
	},

	updateParty: async ({ request, locals, params }) => {
		const form = await request.formData();
		const tenantId = String(form.get('tenantId') ?? '');
		const result = parseLeaseParty(form);
		if (!result.ok) {
			return refuse({ which: 'editParty', errors: result.errors, values: result.values });
		}
		const outcome = await updateLeaseParty(
			locals.db,
			auditContext(locals),
			params.id,
			tenantId,
			result.data
		);
		if (!outcome.ok && outcome.reason === 'missing') notFound();
		if (!outcome.ok) {
			const [field, message] = partyError(outcome.reason as Exclude<LeasePartyRefusal, 'missing'>);
			return refuse({
				which: 'editParty',
				errors: { [field]: message },
				values: { joinedOn: result.data.joinedOn ?? '', leftOn: result.data.leftOn ?? '' }
			});
		}
		redirect(303, `/vertraege/${params.id}`);
	},

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

	updatePersons: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const form = await request.formData();
		const rowId = String(form.get('rowId') ?? '');
		const result = parseLeasePersons(form);
		if (!result.ok) {
			return refuse({ which: 'editPersons', errors: result.errors, values: result.values });
		}
		const outcome = await updateLeasePersons(locals.db, context, params.id, rowId, result.data);
		if (outcome === 'missing') notFound();
		if (outcome === 'initial') return fail(400, { message: initialMessage });
		if (outcome !== 'updated') {
			return refuse({
				which: 'editPersons',
				errors: {
					validFrom:
						outcome === 'duplicate'
							? 'Für dieses Datum gibt es schon einen Eintrag.'
							: 'Das Datum liegt nicht nach dem Vertragsbeginn.'
				},
				values: {
					validFrom: result.data.validFrom,
					persons: String(result.data.persons),
					note: result.data.note ?? ''
				}
			});
		}
		redirect(303, `/vertraege/${params.id}`);
	},

	deletePersons: async ({ request, locals, params }) => {
		const context = auditContext(locals);
		const rowId = (await request.formData()).get('rowId');
		if (typeof rowId !== 'string') return fail(400, { message: 'Ungültige Auswahl.' });
		const outcome = await deleteLeasePersons(locals.db, context, params.id, rowId);
		if (outcome === 'missing') notFound();
		if (outcome === 'initial') return fail(400, { message: initialMessage });
		redirect(303, `/vertraege/${params.id}`);
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
			terminatedBy: result.data.terminatedBy,
			state: lease.property.state
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
		if (outcome === 'party-dates') {
			return refuse({
				which: 'end',
				errors: {
					endDate:
						'Ein Mieter tritt erst nach diesem Ende in den Vertrag ein. Nimm seinen Eintritt unter „Vertragsparteien“ zurück oder wähle ein späteres Ende.'
				},
				values
			});
		}
		if (typeof outcome === 'object') {
			return refuse({
				which: 'end',
				errors: {
					endDate: `Bis zu diesem Ende wäre die Einheit doppelt vermietet: ein anderer Vertrag beginnt am ${formatDate(outcome.overlap)}. Wähle ein Ende davor.`
				},
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
				deleteError:
					'Das Löschen geht nicht mehr, weil sich inzwischen etwas geändert hat; die Gründe stehen unten.'
			});
		}
		redirect(303, '/vertraege');
	}
};
