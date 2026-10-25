import { today } from '#lib/dates.ts';
import { loadForecast } from '#lib/server/forecast.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// Prognose of the next twelve months, for the portfolio or one property: ?objekt=<id>.

export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const propertyId = url.searchParams.get('objekt') || null;
	const page = await loadForecast(locals.db, accountId, { propertyId, today: today() });
	return { propertyId, ...page };
};
