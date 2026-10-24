import { today } from '#lib/dates.ts';
import { propertyOverview } from '#lib/server/properties.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// The current properties with their counts; the archived (sold) ones apart, below the list.
export const load: PageServerLoad = async ({ locals }) => {
	const all = await propertyOverview(locals.db, requireAccount(locals), today());
	return {
		properties: all.filter((property) => !property.archivedAt),
		archived: all.filter((property) => property.archivedAt)
	};
};
