import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	return { email: locals.user?.email, name: locals.user?.name, role: locals.user?.role };
};
