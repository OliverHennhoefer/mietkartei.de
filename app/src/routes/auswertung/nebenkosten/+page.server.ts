import { today } from '#lib/dates.ts';
import { loadCostBenchmark } from '#lib/server/cost-benchmark.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// Nebenkosten-Vergleich of one year (default: the latest one that is over) for the portfolio or
// one property: ?jahr=2025, ?objekt=<id>.

export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const currentYear = Number(today().slice(0, 4));
	const value = url.searchParams.get('jahr');
	const year = Number(value);
	const propertyId = url.searchParams.get('objekt') || null;
	const page = await loadCostBenchmark(locals.db, accountId, {
		year: value && Number.isInteger(year) && year >= 1900 && year <= currentYear ? year : null,
		propertyId,
		currentYear
	});
	return { propertyId, ...page };
};
