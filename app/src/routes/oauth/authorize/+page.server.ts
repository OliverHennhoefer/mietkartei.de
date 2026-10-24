import { error, redirect } from '@sveltejs/kit';
import { apiKeyScopes, type ApiKeyScope } from '#lib/server/db/schema.ts';
import { approve, checkAuthorizationRequest, deny, grantableScopes } from '#lib/server/oauth.ts';
import type { Actions, PageServerLoad } from './$types';

// The consent page of OAuth: an app such as the claude.ai connector sends the user here. After
// signing in, they see which app asks, where it returns to, and approve it with read or read and
// write access, or decline. Both answers go back to the app; see #lib/server/oauth.ts.

/** Back to the app, at a redirect URI it registered. */
function toApp(location: string): never {
	redirect(303, location, { external: [new URL(location).origin] });
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const check = await checkAuthorizationRequest(locals.db, url.searchParams, url.origin);
	if (!check.ok) error(400, check.message);
	if (!locals.user)
		redirect(303, `/anmelden?weiter=${encodeURIComponent(url.pathname + url.search)}`);
	// The form's answer is a redirect to the app, which the page's CSP has to allow.
	locals.formRedirectOrigin = new URL(check.request.redirectUri).origin;
	const scopes = grantableScopes(locals.user);
	return {
		client: check.request.client.name,
		host: new URL(check.request.redirectUri).host,
		scopes,
		scope: scopes.includes(check.request.scope) ? check.request.scope : 'read'
	};
};

export const actions: Actions = {
	default: async ({ locals, url, request }) => {
		const check = await checkAuthorizationRequest(locals.db, url.searchParams, url.origin);
		if (!check.ok) error(400, check.message);
		if (!locals.user) error(401, 'Bitte melde dich an.');
		const form = await request.formData();
		if (form.get('decision') !== 'approve') toApp(deny(check.request, url.origin));
		const scope = form.get('scope');
		const chosen = apiKeyScopes.find((value) => value === scope) ?? 'read';
		toApp(await approve(locals.db, locals.user, check.request, chosen as ApiKeyScope, url.origin));
	}
};
