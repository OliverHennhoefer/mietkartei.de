import { error } from '@sveltejs/kit';
import { disclosureReport, getLetting } from '#lib/server/lettings.ts';
import { pdfResponse, renderReport } from '#lib/server/pdf.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** The blank Mieterselbstauskunft of a Neuvermietung, to print and hand out at the viewing. */
export const GET: RequestHandler = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const letting = await getLetting(locals.db, accountId, params.id);
	if (!letting) error(404, 'Diese Neuvermietung gibt es nicht.');
	const { report, filename } = await disclosureReport(locals.db, accountId, letting, null);
	return pdfResponse(await renderReport(report), filename);
};
