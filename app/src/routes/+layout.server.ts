import { DEMO, HOSTED } from '$app/env/private';
import { billingEnabled, billingNotice } from '#lib/server/billing.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		email: locals.user?.email,
		name: locals.user?.name,
		role: locals.user?.role,
		theme: locals.theme,
		billingEnabled: billingEnabled(),
		demo: DEMO,
		// The hosted variant before its public launch; the demo and self-hosted instances never are.
		prelaunch: HOSTED && !DEMO,
		// Only app.mietkartei.de and its demo link the privacy policy and the processing agreement
		// on the website; a self-hosted instance, also on Cloudflare, has another operator.
		hosted: HOSTED,
		notice: locals.user ? await billingNotice(locals) : undefined
	};
};
