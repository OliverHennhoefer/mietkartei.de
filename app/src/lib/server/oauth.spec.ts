import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { authenticateApiKey, listApiKeys, listConnectedApps, revokeApiKey } from './api-keys';
import { listAuditLog } from './audit';
import type { Database } from './db';
import { apiKeys, oauthClients, oauthCodes, users } from './db/schema';
import {
	ACCESS_TOKEN_LIFETIME,
	approve,
	authorizationServerMetadata,
	checkAuthorizationRequest,
	CODE_LIFETIME,
	deny,
	exchangeToken,
	grantableScopes,
	OAuthError,
	protectedResourceMetadata,
	REFRESH_TOKEN_LIFETIME,
	registerClient,
	type AuthorizationRequest
} from './oauth';
import { contextA, ownerA, testDatabase } from './testing';

const ORIGIN = 'https://app.example';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'verifier-'.repeat(6);

let db: Database;
let clientId: string;

async function challengeOf(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

async function query(overrides: Record<string, string | null> = {}) {
	const params: Record<string, string | null> = {
		client_id: clientId,
		redirect_uri: REDIRECT,
		response_type: 'code',
		code_challenge: await challengeOf(VERIFIER),
		code_challenge_method: 'S256',
		state: 'xyz',
		...overrides
	};
	return new URLSearchParams(
		Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== null)
	);
}

async function authorizationRequest(overrides: Record<string, string | null> = {}) {
	const check = await checkAuthorizationRequest(db, await query(overrides), ORIGIN);
	if (!check.ok) throw new Error(JSON.stringify(check));
	return check.request;
}

/** Approves for the owner and returns the code from the redirect. */
async function codeFor(
	request: AuthorizationRequest,
	scope: 'read' | 'write' = 'read',
	now?: number
) {
	const location = new URL(await approve(db, ownerA, request, scope, ORIGIN, now));
	expect(location.origin + location.pathname).toBe(REDIRECT);
	expect(location.searchParams.get('state')).toBe('xyz');
	expect(location.searchParams.get('iss')).toBe(ORIGIN);
	return location.searchParams.get('code')!;
}

function exchange(fields: Record<string, string>, now?: number) {
	return exchangeToken(db, new URLSearchParams(fields), now);
}

async function tokensFor(scope: 'read' | 'write' = 'read', now?: number) {
	const code = await codeFor(await authorizationRequest(), scope, now);
	return exchange(
		{
			grant_type: 'authorization_code',
			code,
			client_id: clientId,
			redirect_uri: REDIRECT,
			code_verifier: VERIFIER
		},
		now
	);
}

beforeEach(async () => {
	db = await testDatabase();
	clientId = (await registerClient(db, { client_name: 'Claude', redirect_uris: [REDIRECT] }))
		.client_id;
});

describe('metadata', () => {
	it('points the resource at the authorization server and lists the endpoints', () => {
		expect(protectedResourceMetadata(ORIGIN)).toMatchObject({
			resource: `${ORIGIN}/mcp`,
			authorization_servers: [ORIGIN]
		});
		expect(authorizationServerMetadata(ORIGIN)).toMatchObject({
			issuer: ORIGIN,
			authorization_endpoint: `${ORIGIN}/oauth/authorize`,
			token_endpoint: `${ORIGIN}/oauth/token`,
			registration_endpoint: `${ORIGIN}/oauth/register`,
			code_challenge_methods_supported: ['S256']
		});
	});
});

describe('registerClient', () => {
	it('registers a public client', async () => {
		const registration = await registerClient(db, {
			client_name: '  ChatGPT  ',
			redirect_uris: ['https://chatgpt.com/connector/callback', 'http://127.0.0.1:3000/cb'],
			grant_types: ['authorization_code', 'refresh_token'],
			token_endpoint_auth_method: 'client_secret_post'
		});
		expect(registration).toMatchObject({
			client_name: 'ChatGPT',
			token_endpoint_auth_method: 'none',
			redirect_uris: ['https://chatgpt.com/connector/callback', 'http://127.0.0.1:3000/cb']
		});
		const [row] = await db
			.select()
			.from(oauthClients)
			.where(eq(oauthClients.id, registration.client_id));
		expect(row.redirectUris).toHaveLength(2);
	});

	it('names a client without a name after its redirect host', async () => {
		const registration = await registerClient(db, { redirect_uris: ['https://cursor.example/cb'] });
		expect(registration.client_name).toBe('cursor.example');
	});

	it('refuses unsafe redirect URIs and other grant types', async () => {
		for (const uris of [
			undefined,
			[],
			['myapp://callback'],
			['http://example.org/cb'],
			['https://example.org/cb#fragment'],
			['https://user:pass@example.org/cb'],
			['not a url'],
			[`https://example.org/${'x'.repeat(2000)}`],
			Array.from({ length: 11 }, (_, index) => `https://example.org/${index}`)
		]) {
			await expect(registerClient(db, { redirect_uris: uris })).rejects.toMatchObject({
				code: 'invalid_redirect_uri'
			});
		}
		await expect(
			registerClient(db, { redirect_uris: [REDIRECT], grant_types: ['client_credentials'] })
		).rejects.toBeInstanceOf(OAuthError);
		await expect(registerClient(db, null)).rejects.toBeInstanceOf(OAuthError);
	});

	it('deletes old registrations that never connected, keeping connected ones', async () => {
		await tokensFor();
		const unused = (await registerClient(db, { redirect_uris: [REDIRECT] })).client_id;
		await registerClient(db, { redirect_uris: [REDIRECT] }, Date.now() + 2 * 24 * 3600 * 1000);
		const ids = (await db.select().from(oauthClients)).map((row) => row.id);
		expect(ids).toContain(clientId);
		expect(ids).not.toContain(unused);
	});
});

describe('checkAuthorizationRequest', () => {
	it('accepts a complete request and reads the scope', async () => {
		expect(await authorizationRequest()).toMatchObject({
			redirectUri: REDIRECT,
			state: 'xyz',
			scope: 'read',
			client: { name: 'Claude' }
		});
		expect((await authorizationRequest({ scope: 'read write' })).scope).toBe('write');
		expect((await authorizationRequest({ resource: `${ORIGIN}/mcp` })).scope).toBe('read');
		// With one registered redirect URI, the request may leave it out.
		expect((await authorizationRequest({ redirect_uri: null, state: null })).state).toBeNull();
	});

	it('shows errors about the client or its redirect URI instead of redirecting', async () => {
		const cases: Record<string, string | null>[] = [
			{ client_id: null },
			{ client_id: 'unknown' },
			{ redirect_uri: 'https://evil.example/cb' }
		];
		for (const overrides of cases) {
			const check = await checkAuthorizationRequest(db, await query(overrides), ORIGIN);
			expect(check).toMatchObject({ ok: false, message: expect.any(String) });
		}
	});

	it('shows other errors on the page as well, never redirecting to the app', async () => {
		for (const [overrides, error] of [
			[{ response_type: 'token' }, 'unsupported_response_type'],
			[{ code_challenge: null }, 'invalid_request'],
			[{ code_challenge_method: 'plain' }, 'invalid_request'],
			[{ code_challenge: 'short' }, 'invalid_request'],
			[{ resource: 'https://other.example/mcp' }, 'invalid_target']
		] as const) {
			const check = await checkAuthorizationRequest(db, await query(overrides), ORIGIN);
			expect(check).toEqual({ ok: false, message: expect.stringContaining(error) });
		}
	});

	it('tells the app when the user declines', async () => {
		const location = new URL(deny(await authorizationRequest(), ORIGIN));
		expect(location.searchParams.get('error')).toBe('access_denied');
		expect(location.searchParams.get('state')).toBe('xyz');
	});

	it('lets viewers grant reading only', () => {
		expect(grantableScopes(ownerA)).toEqual(['read', 'write']);
		expect(grantableScopes({ ...ownerA, role: 'viewer' })).toEqual(['read']);
	});
});

describe('exchangeToken', () => {
	it('exchanges a code for tokens that act as the user, once', async () => {
		const code = await codeFor(await authorizationRequest(), 'write');
		const fields = {
			grant_type: 'authorization_code',
			code,
			client_id: clientId,
			redirect_uri: REDIRECT,
			code_verifier: VERIFIER
		};
		const tokens = await exchange(fields);
		expect(tokens).toMatchObject({
			token_type: 'Bearer',
			expires_in: ACCESS_TOKEN_LIFETIME / 1000,
			scope: 'write'
		});
		expect(tokens.access_token).toMatch(/^mk_/);
		expect(tokens.refresh_token).toMatch(/^mkr_/);
		expect(await authenticateApiKey(db, tokens.access_token)).toMatchObject({
			scope: 'write',
			user: { id: 'user-a' }
		});
		await expect(exchange(fields)).rejects.toMatchObject({ code: 'invalid_grant' });

		expect(await listConnectedApps(db, contextA)).toMatchObject([
			{ name: 'Claude', scope: 'write' }
		]);
		expect(await listApiKeys(db, contextA)).toEqual([]);
		const [entry] = await listAuditLog(db, 'a');
		expect(entry.summary).toBe('„Claude“ verbunden (Lesen und Schreiben)');
	});

	it('refuses a code with a wrong verifier, client or redirect URI, or after it expired', async () => {
		const request = await authorizationRequest();
		const base = {
			grant_type: 'authorization_code',
			client_id: clientId,
			redirect_uri: REDIRECT,
			code_verifier: VERIFIER
		};
		for (const overrides of [
			{ code_verifier: 'wrong-'.repeat(8) },
			{ client_id: 'other' },
			{ redirect_uri: 'https://claude.ai/other' }
		]) {
			const code = await codeFor(request);
			await expect(exchange({ ...base, code, ...overrides })).rejects.toMatchObject({
				code: 'invalid_grant'
			});
		}
		const now = Date.now();
		const code = await codeFor(request, 'read', now);
		await expect(exchange({ ...base, code }, now + CODE_LIFETIME)).rejects.toMatchObject({
			code: 'invalid_grant'
		});
		await expect(exchange({ ...base, code: 'unknown' })).rejects.toMatchObject({
			code: 'invalid_grant'
		});
		await expect(exchange({ ...base, code: '' })).rejects.toMatchObject({
			code: 'invalid_request'
		});
		await expect(exchange({ grant_type: 'password' })).rejects.toMatchObject({
			code: 'unsupported_grant_type'
		});
	});

	it('deletes codes nobody picked up', async () => {
		const now = Date.now();
		await codeFor(await authorizationRequest(), 'read', now);
		await codeFor(await authorizationRequest(), 'read', now + CODE_LIFETIME + 1);
		expect(await db.select().from(oauthCodes)).toHaveLength(1);
	});

	it('gives a viewer read access whatever they chose', async () => {
		const request = await authorizationRequest();
		const location = new URL(
			await approve(db, { ...ownerA, role: 'viewer' }, request, 'write', ORIGIN)
		);
		await db.update(users).set({ role: 'viewer' }).where(eq(users.id, 'user-a'));
		const tokens = await exchange({
			grant_type: 'authorization_code',
			code: location.searchParams.get('code')!,
			client_id: clientId,
			code_verifier: VERIFIER
		});
		expect(tokens.scope).toBe('read');
	});

	it('refreshes both tokens, invalidating the old ones', async () => {
		const now = Date.now();
		const first = await tokensFor('read', now);
		const later = now + ACCESS_TOKEN_LIFETIME;
		// The access token runs out after an hour, the connection stays.
		expect(await authenticateApiKey(db, first.access_token, later)).toBeUndefined();
		expect(await db.select().from(apiKeys)).toHaveLength(1);

		const second = await exchange(
			{ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId },
			later
		);
		expect(second.scope).toBe('read');
		expect(await authenticateApiKey(db, second.access_token, later)).toMatchObject({
			scope: 'read'
		});
		expect(await authenticateApiKey(db, first.access_token, now)).toBeUndefined();
		await expect(
			exchange({ grant_type: 'refresh_token', refresh_token: first.refresh_token }, later)
		).rejects.toMatchObject({ code: 'invalid_grant' });
		await expect(
			exchange({ grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: 'x' })
		).rejects.toMatchObject({ code: 'invalid_grant' });
		await expect(
			exchange(
				{ grant_type: 'refresh_token', refresh_token: second.refresh_token },
				later + REFRESH_TOKEN_LIFETIME
			)
		).rejects.toMatchObject({ code: 'invalid_grant' });
	});

	it('ends with the connection when the user disconnects the app', async () => {
		const tokens = await tokensFor();
		const [app] = await listConnectedApps(db, contextA);
		expect(await revokeApiKey(db, contextA, app.id)).toBe(true);
		expect(await authenticateApiKey(db, tokens.access_token)).toBeUndefined();
		await expect(
			exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })
		).rejects.toMatchObject({ code: 'invalid_grant' });
		const [entry] = await listAuditLog(db, 'a');
		expect(entry.summary).toBe('Verbindung mit „Claude“ getrennt');
	});
});
