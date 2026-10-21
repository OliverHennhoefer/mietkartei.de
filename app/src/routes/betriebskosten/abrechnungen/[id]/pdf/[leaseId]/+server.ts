import { error } from '@sveltejs/kit';
import { pdfResponse, renderLetter } from '#lib/server/pdf.ts';
import { requireAccount } from '#lib/server/session.ts';
import { getLeaseResult, statementFilename, statementLetter } from '#lib/server/statements.ts';
import type { RequestHandler } from './$types';

// The statement letter of one lease, printed from the frozen statement_results row alone.
export const GET: RequestHandler = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const result = await getLeaseResult(locals.db, accountId, params.id, params.leaseId);
	if (!result) error(404, 'Zu dieser Abrechnung gibt es kein freigegebenes Ergebnis.');
	const bytes = await renderLetter(statementLetter(result));
	return pdfResponse(bytes, statementFilename(result));
};
