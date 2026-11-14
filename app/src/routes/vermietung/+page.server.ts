import { listLettings, lettingSuggestions } from '#lib/server/lettings.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// Neuvermietung: the open and closed lettings with their applicants counted, and the units that
// are vacant or become free soon without a letting yet.
export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	const [lettings, suggestions] = await Promise.all([
		listLettings(locals.db, accountId),
		lettingSuggestions(locals.db, accountId)
	]);
	return { lettings, suggestions };
};
