import {
	currentIndexValues,
	indexFetchConfigured,
	lastIndexFetch
} from '#lib/server/consumer-price-index.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireAccount(locals);
	const values = await currentIndexValues(locals.db);
	return {
		values: values.map(({ month, value }) => ({ month, value })),
		configured: indexFetchConfigured,
		lastFetch: (await lastIndexFetch(locals.db)) ?? null
	};
};
