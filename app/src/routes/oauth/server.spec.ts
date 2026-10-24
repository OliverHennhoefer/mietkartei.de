import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateApiKey } from '#lib/server/api-keys.ts';
import type { Database } from '#lib/server/db/index.ts';
import { approve, checkAuthorizationRequest } from '#lib/server/oauth.ts';
import { ownerA, testDatabase } from '#lib/server/testing.ts';
import { GET as authorizationServer } from '../.well-known/oauth-authorization-server/[...rest]/+server';
import { GET as protectedResource } from '../.well-known/oauth-protected-resource/[...rest]/+server';
import { OPTIONS, POST as register } from './register/+server';
import { POST as token } from './token/+server';

const limiter = vi.hoisted(() => ({ allow: true }));
vi.mock('#lib/server/rate-limit/index.ts', () => ({
	getApiLimiter: async () => ({ limit: async () => limiter.allow })
}));

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'verifier-'.repeat(6);

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	limiter.allow = true;
});

function event(path: string, init?: RequestInit) {
	const url = new URL(path, 'http://localhost');
	return {
		request: new Request(url, init),
		url,
		locals: { db, user: undefined },
		getClientAddress: () => '10.0.0.3'
	} as never;
}

const registerWith = (body: string) =>
	register(
		event('/oauth/register', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		})
	);

const tokenWith = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
	token(
		event('/oauth/token', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
			body: new URLSearchParams(fields).toString()
		})
	);

async function challengeOf(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

describe('OAuth endpoints', () => {
	it('publish the metadata to anyone', async () => {
		const resource = await protectedResource(event('/.well-known/oauth-protected-resource/mcp'));
		expect(resource.headers.get('access-control-allow-origin')).toBe('*');
		expect(await resource.json()).toMatchObject({ resource: 'http://localhost/mcp' });
		const server = await authorizationServer(event('/.well-known/oauth-authorization-server'));
		expect(await server.json()).toMatchObject({ issuer: 'http://localhost' });
	});

	it('register a client, connect it and hand out tokens', async () => {
		const registered = await registerWith(
			JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] })
		);
		expect(registered.status).toBe(201);
		const { client_id } = await registered.json();

		const params = new URLSearchParams({
			client_id,
			redirect_uri: REDIRECT,
			response_type: 'code',
			code_challenge: await challengeOf(VERIFIER),
			code_challenge_method: 'S256'
		});
		const check = await checkAuthorizationRequest(db, params, 'http://localhost');
		if (!check.ok) throw new Error('refused');
		const location = new URL(await approve(db, ownerA, check.request, 'read', 'http://localhost'));
		const response = await tokenWith(
			{
				grant_type: 'authorization_code',
				code: location.searchParams.get('code')!,
				code_verifier: VERIFIER
			},
			// Apps registered without a secret may send their id this way all the same.
			{ authorization: `Basic ${btoa(`${client_id}:`)}` }
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const tokens = await response.json();
		expect(await authenticateApiKey(db, tokens.access_token)).toMatchObject({ scope: 'read' });
	});

	it('answer refusals in the OAuth error format', async () => {
		const badClient = await registerWith(JSON.stringify({ redirect_uris: ['myapp://cb'] }));
		expect(badClient.status).toBe(400);
		expect(await badClient.json()).toMatchObject({ error: 'invalid_redirect_uri' });
		const notJson = await registerWith('{');
		expect(notJson.status).toBe(400);
		expect(await notJson.json()).toMatchObject({ error: 'invalid_client_metadata' });

		const badGrant = await tokenWith({ grant_type: 'password' });
		expect(badGrant.status).toBe(400);
		expect(await badGrant.json()).toMatchObject({ error: 'unsupported_grant_type' });
		const badBasic = await tokenWith(
			{ grant_type: 'authorization_code' },
			{ authorization: 'Basic %%%' }
		);
		expect(badBasic.status).toBe(401);
	});

	it('limit requests per client address', async () => {
		limiter.allow = false;
		expect((await registerWith('{}')).status).toBe(429);
		const limited = await tokenWith({ grant_type: 'refresh_token' });
		expect(limited.status).toBe(429);
		expect(limited.headers.get('retry-after')).toBe('60');
	});

	it('allow pages of other sites to register', async () => {
		const response = await OPTIONS(event('/oauth/register', { method: 'OPTIONS' }));
		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-headers')).toBe('content-type');
	});
});
