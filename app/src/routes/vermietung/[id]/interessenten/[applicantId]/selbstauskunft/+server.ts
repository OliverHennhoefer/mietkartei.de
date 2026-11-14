import { error } from '@sveltejs/kit';
import { disclosureReport, getApplicant, getLetting } from '#lib/server/lettings.ts';
import { pdfResponse, renderReport } from '#lib/server/pdf.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** The Mieterselbstauskunft of one applicant with their answers. */
export const GET: RequestHandler = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const letting = await getLetting(locals.db, accountId, params.id);
	const applicant =
		letting && (await getApplicant(locals.db, accountId, letting.id, params.applicantId));
	if (!letting || !applicant) error(404, 'Diesen Interessenten gibt es nicht.');
	const { report, filename } = await disclosureReport(locals.db, accountId, letting, applicant);
	return pdfResponse(await renderReport(report), filename);
};
