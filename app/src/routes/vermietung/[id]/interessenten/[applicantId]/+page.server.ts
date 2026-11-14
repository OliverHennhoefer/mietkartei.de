import { error, fail, redirect } from '@sveltejs/kit';
import { formatDate } from '#lib/dates.ts';
import {
	deletionDate,
	isClosedStatus,
	proofsFor,
	rentBurden,
	type ProofKey
} from '#lib/domain/applicants.ts';
import { parseApplicant, selfDisclosureValues } from '#lib/forms/lettings.ts';
import { landlordAddress } from '#lib/server/accounts.ts';
import {
	acceptApplicant,
	createDisclosureLink,
	deleteApplicant,
	disclosurePath,
	getApplicant,
	getLetting,
	manualStatuses,
	revokeDisclosureLink,
	setApplicantStatus,
	setProof,
	updateApplicant,
	type ManualStatus
} from '#lib/server/lettings.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

// One Mietinteressent: their Selbstauskunft and the landlord's note, the proofs shown, the secret
// link through which they fill in the Selbstauskunft themselves, and the decision: the Zusage
// makes them a tenant and opens the lease form with the terms of the letting.

async function context(event: Pick<RequestEvent, 'locals' | 'params'>) {
	const accountId = requireAccount(event.locals);
	const letting = await getLetting(event.locals.db, accountId, event.params.id);
	const applicant =
		letting &&
		(await getApplicant(event.locals.db, accountId, letting.id, event.params.applicantId));
	if (!letting || !applicant) error(404, 'Diesen Interessenten gibt es nicht.');
	return { letting, applicant };
}

const text = (value: string | null) => value ?? '';

export const load: PageServerLoad = async (event) => {
	const { letting, applicant } = await context(event);
	const landlord = await landlordAddress(event.locals.db, letting.accountId);
	const now = Date.now();
	return {
		letting,
		// The hash stays on the server.
		applicant: { ...applicant, disclosureTokenHash: undefined },
		landlordName: landlord.name,
		burden: rentBurden(letting, applicant.netIncome),
		proofs: proofsFor(letting).map((proof) => ({ ...proof, on: applicant[proof.key] })),
		link: {
			active:
				applicant.disclosureTokenHash !== null &&
				applicant.disclosureExpiresAt !== null &&
				applicant.disclosureExpiresAt.getTime() > now,
			expiresAt: applicant.disclosureExpiresAt,
			submittedAt: applicant.disclosureSubmittedAt
		},
		deletesOn:
			isClosedStatus(applicant.status) && applicant.decidedOn
				? deletionDate(applicant.decidedOn)
				: letting.closedAt
					? deletionDate(letting.closedAt)
					: null,
		values: {
			...selfDisclosureValues(applicant),
			viewingAt: text(applicant.viewingAt),
			notes: text(applicant.notes),
			rating: applicant.rating === null ? '' : String(applicant.rating)
		}
	};
};

const closedMessage =
	'Die Neuvermietung ist abgeschlossen; Interessenten lassen sich nicht mehr ändern.';

export const actions: Actions = {
	update: async (event) => {
		const { letting, applicant } = await context(event);
		if (letting.closedAt) return fail(400, { message: closedMessage });
		const result = parseApplicant(await event.request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		await updateApplicant(event.locals.db, auditContext(event.locals), applicant, result.data);
		return { saved: true };
	},
	status: async (event) => {
		const { letting, applicant } = await context(event);
		if (letting.closedAt) return fail(400, { message: closedMessage });
		const status = String((await event.request.formData()).get('status') ?? '');
		if (!(manualStatuses as readonly string[]).includes(status)) {
			return fail(400, { message: 'Diesen Status gibt es nicht.' });
		}
		if (applicant.status === 'accepted') {
			return fail(400, { message: 'Nach der Zusage lässt sich der Status nicht mehr ändern.' });
		}
		await setApplicantStatus(
			event.locals.db,
			auditContext(event.locals),
			applicant,
			status as ManualStatus
		);
		return { statusSet: true };
	},
	proof: async (event) => {
		const { letting, applicant } = await context(event);
		if (letting.closedAt) return fail(400, { message: closedMessage });
		const form = await event.request.formData();
		const key = String(form.get('key') ?? '');
		if (!proofsFor(letting).some((proof) => proof.key === key)) {
			return fail(400, { message: 'Diesen Nachweis gibt es nicht.' });
		}
		await setProof(
			event.locals.db,
			auditContext(event.locals),
			applicant,
			key as ProofKey,
			form.get('shown') === '1'
		);
		return { proofSet: true };
	},
	link: async (event) => {
		const { letting, applicant } = await context(event);
		if (letting.closedAt || applicant.status === 'accepted' || isClosedStatus(applicant.status)) {
			return fail(400, {
				message: 'Für diesen Interessenten lässt sich kein Link mehr erstellen.'
			});
		}
		const { token, expiresAt } = await createDisclosureLink(
			event.locals.db,
			auditContext(event.locals),
			applicant
		);
		return {
			linkUrl: `${event.url.origin}${disclosurePath(token)}`,
			linkExpires: formatDate(expiresAt.toISOString().slice(0, 10))
		};
	},
	revoke: async (event) => {
		const { applicant } = await context(event);
		await revokeDisclosureLink(event.locals.db, auditContext(event.locals), applicant);
		return { revoked: true };
	},
	accept: async (event) => {
		const { letting, applicant } = await context(event);
		const result = await acceptApplicant(event.locals.db, auditContext(event.locals), applicant);
		if (!result)
			return fail(400, { message: 'Diesem Interessenten lässt sich keine Zusage mehr geben.' });
		const query = new URLSearchParams({
			unitId: letting.unitId,
			vermietung: letting.id,
			created: '1'
		});
		for (const id of result.tenantIds) query.append('tenantId', id);
		redirect(303, `/vertraege/neu?${query}`);
	},
	delete: async (event) => {
		const { letting, applicant } = await context(event);
		await deleteApplicant(event.locals.db, auditContext(event.locals), applicant);
		redirect(303, `/vermietung/${letting.id}`);
	}
};
