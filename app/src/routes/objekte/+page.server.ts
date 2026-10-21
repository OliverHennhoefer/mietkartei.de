import { today } from '#lib/dates.ts';
import { propertyOverview } from '#lib/server/properties.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return { properties: await propertyOverview(locals.db, requireAccount(locals), today()) };
};
