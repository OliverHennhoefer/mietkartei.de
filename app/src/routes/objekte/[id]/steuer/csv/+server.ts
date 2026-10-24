import { today } from '#lib/dates.ts';
import { getProperty } from '#lib/server/properties.ts';
import { requireAccount } from '#lib/server/session.ts';
import { csvResponse, loadTaxOverview, taxCsv, taxFilename } from '#lib/server/tax.ts';
import { error } from '@sveltejs/kit';
import { taxYearOf } from '../year';
import type { RequestHandler } from './$types';

// The Steuerübersicht of ?jahr= as CSV, for the Steuerberater or a spreadsheet.
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const accountId = requireAccount(locals);
	const property = await getProperty(locals.db, accountId, params.id);
	if (!property) error(404, 'Dieses Objekt gibt es nicht.');
	const year = taxYearOf(url.searchParams.get('jahr'), today());
	const page = await loadTaxOverview(locals.db, accountId, property, year);
	return csvResponse(taxCsv(property, page), taxFilename(property, year, 'csv'));
};
