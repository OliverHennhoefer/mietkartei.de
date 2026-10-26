import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The app starts on Aufgaben: what is due and what needs doing.
export const load: PageServerLoad = () => {
	redirect(303, '/aufgaben');
};
