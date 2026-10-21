import { requireOwner } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireOwner(locals);
	return {};
};
