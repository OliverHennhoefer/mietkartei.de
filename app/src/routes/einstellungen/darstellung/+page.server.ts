import { themes, type Theme } from '#lib/server/db/schema.ts';
import { setShowPropertyMaps, setTheme, showsPropertyMaps } from '#lib/server/preferences.ts';
import { requireUser } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// How the app looks to the signed-in user; viewers may change it too, it only affects them.

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	return { theme: locals.theme, showPropertyMaps: await showsPropertyMaps(locals.db, user.id) };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await request.formData();
		const theme = form.get('theme');
		if (themes.includes(theme as Theme)) await setTheme(locals.db, user.id, theme as Theme);
		await setShowPropertyMaps(locals.db, user.id, form.get('showPropertyMaps') === 'on');
		return { saved: true };
	}
};
