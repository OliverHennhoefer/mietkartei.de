import { listDamageReports } from '#lib/server/damage-reports.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// What tenants reported through their Mieterportal links; each lease's link is made in its
// Mieterportal tab.
export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	return listDamageReports(locals.db, accountId);
};
