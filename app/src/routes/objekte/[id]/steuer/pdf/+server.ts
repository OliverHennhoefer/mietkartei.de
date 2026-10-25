import { today } from '#lib/dates.ts';
import { pdfResponse, renderReport } from '#lib/server/pdf.ts';
import { getProperty } from '#lib/server/properties.ts';
import { requireAccount } from '#lib/server/session.ts';
import { loadTaxOverview, taxFilename, taxReport } from '#lib/server/tax.ts';
import { error } from '@sveltejs/kit';
import { taxYearOf } from '../year';
import type { RequestHandler } from './$types';

// The Steuerübersicht of ?jahr= as PDF, for the Steuerberater.
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const accountId = requireAccount(locals);
	const property = await getProperty(locals.db, accountId, params.id);
	if (!property) error(404, 'Dieses Objekt gibt es nicht.');
	const year = taxYearOf(url.searchParams.get('jahr'), today());
	const page = await loadTaxOverview(locals.db, accountId, property, year);
	const report = await taxReport(locals.db, accountId, property, page);
	return pdfResponse(await renderReport(report), taxFilename(property, year, 'pdf'));
};
