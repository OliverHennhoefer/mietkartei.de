import { DEMO } from '$app/env/private';
import { billingEnabled, billingNotice } from '#lib/server/billing.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		email: locals.user?.email,
		name: locals.user?.name,
		role: locals.user?.role,
		billingEnabled: billingEnabled(),
		demo: DEMO,
		// The hosted variant before its public launch; the demo and self-hosted instances never are.
		prelaunch: __DEPLOY_TARGET__ === 'cloudflare' && !DEMO,
		notice: locals.user ? await billingNotice(locals) : undefined
	};
};
