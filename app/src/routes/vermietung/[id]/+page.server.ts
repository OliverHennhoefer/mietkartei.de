import { error, fail, redirect } from '@sveltejs/kit';
import { formatDate } from '#lib/dates.ts';
import {
	byStatus,
	deletionDate,
	householdSize,
	proofCount,
	rentBurden,
	warmRent
} from '#lib/domain/applicants.ts';
import { parseApplicant, parseLetting } from '#lib/forms/lettings.ts';
import { formatCentsPlain } from '#lib/money.ts';
import { landlordAddress } from '#lib/server/accounts.ts';
import {
	closeLetting,
	createApplicant,
	deleteLetting,
	getLetting,
	listApplicants,
	updateLetting
} from '#lib/server/lettings.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// A Neuvermietung: its terms, the applicants side by side with what makes them comparable (who
// moves in, the rent burden, the proofs shown), and the form to add one. ?bearbeiten=1 opens the
// terms in the edit dialog.
const missing = 'Diese Neuvermietung gibt es nicht.';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const accountId = requireAccount(locals);
	const letting = await getLetting(locals.db, accountId, params.id);
	if (!letting) error(404, missing);
	const [applicants, landlord] = await Promise.all([
		listApplicants(locals.db, accountId, letting.id),
		landlordAddress(locals.db, accountId)
	]);
	const rows = applicants
		.map((applicant) => ({
			id: applicant.id,
			name: `${applicant.firstName} ${applicant.lastName}`,
			coName:
				applicant.coFirstName && applicant.coLastName
					? `${applicant.coFirstName} ${applicant.coLastName}`
					: null,
			status: applicant.status,
			viewingAt: applicant.viewingAt,
			household: householdSize(applicant),
			children: applicant.children,
			netIncome: applicant.netIncome,
			burden: rentBurden(letting, applicant.netIncome),
			pets: applicant.pets,
			insolvency: applicant.insolvency,
			moveInDate: applicant.moveInDate,
			proofs: proofCount(applicant, letting),
			rating: applicant.rating,
			submitted: applicant.disclosureSubmittedAt !== null,
			deletesOn:
				(applicant.status === 'rejected' || applicant.status === 'withdrawn') && applicant.decidedOn
					? deletionDate(applicant.decidedOn)
					: null
		}))
		.sort((a, b) => byStatus(a.status, b.status));
	return {
		letting,
		warmRent: warmRent(letting),
		applicants: rows,
		deletesOn: letting.closedAt ? deletionDate(letting.closedAt) : null,
		landlordComplete: landlord.complete,
		editing:
			url.searchParams.has('bearbeiten') && !letting.closedAt
				? {
						availableFrom: letting.availableFrom ?? '',
						baseRent: formatCentsPlain(letting.baseRent),
						operatingCostPrepayment: formatCentsPlain(letting.operatingCostPrepayment),
						heatingCostPrepayment: formatCentsPlain(letting.heatingCostPrepayment),
						securityDeposit: formatCentsPlain(letting.securityDeposit),
						requiresWbs: letting.requiresWbs ? 'on' : '',
						notes: letting.notes ?? ''
					}
				: null
	};
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const form = await request.formData();
		const letting = await getLetting(locals.db, requireAccount(locals), params.id);
		if (!letting) error(404, missing);
		form.set('unitId', letting.unitId);
		const result = parseLetting(form);
		if (!result.ok) return fail(400, { edit: true, errors: result.errors, values: result.values });
		await updateLetting(locals.db, auditContext(locals), letting.id, result.data);
		redirect(303, `/vermietung/${letting.id}`);
	},
	delete: async ({ locals, params }) => {
		if (!(await deleteLetting(locals.db, auditContext(locals), params.id))) error(404, missing);
		redirect(303, '/vermietung');
	},
	close: async ({ locals, params }) => {
		if (!(await closeLetting(locals.db, auditContext(locals), params.id))) error(404, missing);
		return { closed: true };
	},
	addApplicant: async ({ request, locals, params }) => {
		const result = parseApplicant(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const id = await createApplicant(locals.db, auditContext(locals), params.id, result.data);
		if (!id) error(404, missing);
		return {
			added: `${result.data.firstName} ${result.data.lastName}`,
			viewing: result.data.viewingAt
				? formatDate(result.data.viewingAt.slice(0, 10)) + ', ' + result.data.viewingAt.slice(11)
				: null
		};
	}
};
