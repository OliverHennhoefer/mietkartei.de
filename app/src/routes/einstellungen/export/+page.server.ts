import { canRestore } from '#lib/server/restore.ts';
import { requireOwner } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireOwner(locals);
	return { canRestore: await canRestore(locals.db, user.accountId) };
};
