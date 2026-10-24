import { beforeEach, describe, expect, it } from 'vitest';
import { listConnectedApps } from '#lib/server/api-keys.ts';
import type { Database } from '#lib/server/db/index.ts';
import { registerClient } from '#lib/server/oauth.ts';
import { contextA, outcome, ownerA, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
// The base64url SHA-256 of some verifier; its value does not matter here.
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

let db: Database;
let url: string;

beforeEach(async () => {
	db = await testDatabase();
	const { client_id } = await registerClient(db, {
		client_name: 'Claude',
		redirect_uris: [REDIRECT]
	});
	url = `/oauth/authorize?${new URLSearchParams({
		client_id,
		redirect_uri: REDIRECT,
		response_type: 'code',
		code_challenge: CHALLENGE,
		code_challenge_method: 'S256',
		state: 's',
		scope: 'write'
	})}`;
});

describe('load', () => {
	it('shows the app, where it returns to and the scopes the user may grant', async () => {
		const event = routeEvent(db, { url }) as never as { locals: App.Locals };
		expect(await outcome(() => load(event as never))).toEqual({
			data: { client: 'Claude', host: 'claude.ai', scopes: ['read', 'write'], scope: 'write' }
		});
		expect(event.locals.formRedirectOrigin).toBe('https://claude.ai');
		const viewer = { ...ownerA, role: 'viewer' as const };
		expect(await outcome(() => load(routeEvent(db, { url, user: viewer })))).toMatchObject({
			data: { scopes: ['read'], scope: 'read' }
		});
	});

	it('sends visitors to sign in and back', async () => {
		expect(await outcome(() => load(routeEvent(db, { url, user: null })))).toEqual({
			redirect: `/anmelden?weiter=${encodeURIComponent(url)}`
		});
	});

	it('shows errors instead of redirecting to the app', async () => {
		expect(
			await outcome(() => load(routeEvent(db, { url: '/oauth/authorize?client_id=x' })))
		).toMatchObject({ error: 400 });
		const unsupported = await outcome(() =>
			load(routeEvent(db, { url: url.replace('response_type=code', 'response_type=token') }))
		);
		expect(unsupported).toMatchObject({ error: 400 });
	});
});

describe('answer', () => {
	const answer = (form: Record<string, string>, target = url, user?: null) =>
		outcome(() => actions.default(routeEvent(db, { url: target, form, user })));

	it('approves with the chosen scope and sends the code to the app', async () => {
		const result = (await answer({ decision: 'approve', scope: 'write' })) as { redirect: string };
		const location = new URL(result.redirect);
		expect(location.origin + location.pathname).toBe(REDIRECT);
		expect(location.searchParams.get('code')).toBeTruthy();
		expect(location.searchParams.get('state')).toBe('s');
	});

	it('tells the app when the user declines', async () => {
		const result = (await answer({ decision: 'deny' })) as { redirect: string };
		expect(new URL(result.redirect).searchParams.get('error')).toBe('access_denied');
		expect(await listConnectedApps(db, contextA)).toEqual([]);
	});

	it('refuses invalid requests and visitors', async () => {
		expect(await answer({ decision: 'approve' }, '/oauth/authorize')).toMatchObject({
			error: 400
		});
		const unsupported = await answer(
			{ decision: 'approve' },
			url.replace('response_type=code', 'response_type=token')
		);
		expect(unsupported).toMatchObject({ error: 400 });
		expect(await answer({ decision: 'approve' }, url, null)).toMatchObject({ error: 401 });
	});
});
