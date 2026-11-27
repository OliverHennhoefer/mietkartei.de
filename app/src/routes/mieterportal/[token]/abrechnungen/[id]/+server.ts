import { error } from '@sveltejs/kit';
import { statementFilename, statementLetter } from '#lib/domain/statement-letter.ts';
import { pdfResponse, renderLetter } from '#lib/server/pdf.ts';
import { getLeaseResult } from '#lib/server/statements.ts';
import { openPortal, portalStatement } from '#lib/server/tenant-portal.ts';
import type { RequestHandler } from './$types';

// The statement letter of the lease, as the landlord prints it, once it reached the tenants.
export const GET: RequestHandler = async ({ locals, params }) => {
	const access = await openPortal(locals.db, params.token);
	if (!access) error(404, 'Dieser Link gilt nicht mehr.');
	const found = await portalStatement(locals.db, access, params.id);
	const result =
		found && (await getLeaseResult(locals.db, access.accountId, found.statementId, found.leaseId));
	if (!result) error(404, 'Diese Abrechnung gibt es nicht.');
	return pdfResponse(await renderLetter(statementLetter(result)), statementFilename(result));
};
