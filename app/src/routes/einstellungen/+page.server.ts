import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The settings open on the profile; the sections are listed in the dialog's own navigation.
export const load: PageServerLoad = () => {
	redirect(303, '/einstellungen/profil');
};
