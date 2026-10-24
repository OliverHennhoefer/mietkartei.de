import { and, eq, lt, notExists } from 'drizzle-orm';
import { API_KEY_PREFIX } from './api-keys';
import { auditEntry } from './audit';
import { generateToken, hashToken, type SessionUser } from './auth';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { apiKeys, oauthClients, oauthCodes, users, type ApiKeyScope } from './db/schema';

// OAuth 2.1 for the MCP server, as the MCP specification asks of remote servers, so assistants
// such as the claude.ai and ChatGPT connectors connect with nothing but the server's address: the
// app registers itself (RFC 7591), sends the user to /oauth/authorize, where they sign in and
// approve read or read and write access, and exchanges the code for tokens (with PKCE, S256 only).
// A connected app is a row in api_keys whose key is the access token, see the schema; so it has
// the rights of its user, shows up in the audit log under them, and goes wherever keys go.
// See https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization.

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
export const CODE_LIFETIME = 10 * MINUTE;
export const ACCESS_TOKEN_LIFETIME = 60 * MINUTE;
/** A connection the app does not use for this long ends; every refresh starts it again. */
export const REFRESH_TOKEN_LIFETIME = 90 * DAY;
/** Registrations that never led to a connection are deleted after this long. */
const UNUSED_CLIENT_LIFETIME = DAY;
/** Refresh tokens start with this; access tokens are API keys and start with mk_. */
const REFRESH_PREFIX = 'mkr_';

export const OAUTH_SCOPES: readonly ApiKeyScope[] = ['read', 'write'];

/** Where the MCP server lives, the resource the tokens are for. */
export function resourceOf(origin: string): string {
	return `${origin}/mcp`;
}

/** RFC 9728: tells the client which authorization server issues tokens for /mcp. */
export function protectedResourceMetadata(origin: string) {
	return {
		resource: resourceOf(origin),
		authorization_servers: [origin],
		scopes_supported: OAUTH_SCOPES,
		bearer_methods_supported: ['header'],
		resource_name: 'mietkartei',
		resource_documentation: 'https://docs.mietkartei.de/anleitungen/ki-assistenten/'
	};
}

/** RFC 8414: the endpoints and what they support. */
export function authorizationServerMetadata(origin: string) {
	return {
		issuer: origin,
		authorization_endpoint: `${origin}/oauth/authorize`,
		token_endpoint: `${origin}/oauth/token`,
		registration_endpoint: `${origin}/oauth/register`,
		scopes_supported: OAUTH_SCOPES,
		response_types_supported: ['code'],
		response_modes_supported: ['query'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		token_endpoint_auth_methods_supported: ['none'],
		code_challenge_methods_supported: ['S256'],
		authorization_response_iss_parameter_supported: true,
		service_documentation: 'https://docs.mietkartei.de/anleitungen/ki-assistenten/'
	};
}

/** An OAuth error as the token and registration endpoints answer it. */
export class OAuthError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status = 400
	) {
		super(message);
	}
}

const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 2000;

/**
 * A redirect URI an app may register: https, or http to the own machine for desktop apps (RFC
 * 8252). Custom schemes and fragments are refused.
 */
function validRedirectUri(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > MAX_URI_LENGTH) return false;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.hash || url.username || url.password) return false;
	if (url.protocol === 'https:') return true;
	return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

/**
 * Registers an app (RFC 7591) and returns its registration. Only public clients exist: whatever
 * authentication method the app asks for, it gets "none" and proves itself with PKCE.
 */
export async function registerClient(db: Database, body: unknown, now = Date.now()) {
	const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
	const uris = input.redirect_uris;
	if (
		!Array.isArray(uris) ||
		uris.length === 0 ||
		uris.length > MAX_REDIRECT_URIS ||
		!uris.every(validRedirectUri)
	) {
		throw new OAuthError(
			'invalid_redirect_uri',
			'redirect_uris must list 1 to 10 https URIs, or http URIs to localhost.'
		);
	}
	const grantTypes = input.grant_types ?? ['authorization_code'];
	if (
		!Array.isArray(grantTypes) ||
		!grantTypes.every((type) => type === 'authorization_code' || type === 'refresh_token')
	) {
		throw new OAuthError('invalid_client_metadata', 'Only authorization_code and refresh_token.');
	}
	const rawName = typeof input.client_name === 'string' ? input.client_name.trim() : '';
	const name = (rawName || new URL(uris[0]).hostname).slice(0, 100);
	// Registrations that never led to a connection pile up otherwise; anyone may register.
	await db
		.delete(oauthClients)
		.where(
			and(
				lt(oauthClients.createdAt, new Date(now - UNUSED_CLIENT_LIFETIME)),
				notExists(db.select().from(apiKeys).where(eq(apiKeys.clientId, oauthClients.id)))
			)
		);
	const id = generateToken();
	const createdAt = new Date(now);
	await db.insert(oauthClients).values({ id, name, redirectUris: uris, createdAt });
	return {
		client_id: id,
		client_id_issued_at: Math.floor(now / 1000),
		client_name: name,
		redirect_uris: uris,
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		token_endpoint_auth_method: 'none'
	};
}

export type OAuthClient = typeof oauthClients.$inferSelect;

export type AuthorizationRequest = {
	client: OAuthClient;
	redirectUri: string;
	state: string | null;
	codeChallenge: string;
	/** The scope the app asked for; the user may still grant less. */
	scope: ApiKeyScope;
};

/**
 * The result of checking the query of /oauth/authorize. Errors are shown on the page, never sent
 * to the redirect URI: anyone may register an app with any redirect URI, and a broken request
 * would otherwise make our address redirect to it without the user doing anything (RFC 9700,
 * section 4.11.2). Only the user's answer goes back to the app.
 */
export type AuthorizationCheck =
	{ ok: true; request: AuthorizationRequest } | { ok: false; message: string };

/** The URI to send the user back to the app with, carrying the result and the issuer. */
export function redirectWith(
	redirectUri: string,
	params: Record<string, string | null>,
	origin: string
): string {
	const url = new URL(redirectUri);
	for (const [name, value] of Object.entries(params)) {
		if (value !== null) url.searchParams.set(name, value);
	}
	url.searchParams.set('iss', origin);
	return url.toString();
}

/** The scope parameter as one of ours: write when asked for, otherwise read. */
function requestedScope(value: string | null): ApiKeyScope {
	return value?.split(' ').includes('write') ? 'write' : 'read';
}

export async function checkAuthorizationRequest(
	db: Database,
	params: URLSearchParams,
	origin: string
): Promise<AuthorizationCheck> {
	const clientId = params.get('client_id');
	const [client] = clientId
		? await db.select().from(oauthClients).where(eq(oauthClients.id, clientId))
		: [];
	if (!client) {
		return { ok: false, message: 'Diese App ist nicht bei mietkartei angemeldet.' };
	}
	const requestedUri = params.get('redirect_uri');
	const redirectUri =
		requestedUri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
	if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
		return { ok: false, message: 'Die Rücksprungadresse der App ist nicht angemeldet.' };
	}
	const fail = (error: string, description: string): AuthorizationCheck => ({
		ok: false,
		message: `Die Anfrage der App ist ungültig (${error}: ${description})`
	});
	if (params.get('response_type') !== 'code') {
		return fail('unsupported_response_type', 'Only response_type=code is supported.');
	}
	const codeChallenge = params.get('code_challenge');
	if (!codeChallenge || params.get('code_challenge_method') !== 'S256') {
		return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
	}
	if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
		return fail('invalid_request', 'code_challenge is not a base64url SHA-256.');
	}
	const resource = params.get('resource');
	if (resource && ![resourceOf(origin), `${resourceOf(origin)}/`, origin].includes(resource)) {
		return fail('invalid_target', `The resource is ${resourceOf(origin)}.`);
	}
	return {
		ok: true,
		request: {
			client,
			redirectUri,
			state: params.get('state'),
			codeChallenge,
			scope: requestedScope(params.get('scope'))
		}
	};
}

/** The scopes a user may grant: viewers only read. */
export function grantableScopes(user: SessionUser): ApiKeyScope[] {
	return user.role === 'viewer' ? ['read'] : ['read', 'write'];
}

/** Approves the request for the user and returns the URI that brings the code to the app. */
export async function approve(
	db: Database,
	user: SessionUser,
	request: AuthorizationRequest,
	scope: ApiKeyScope,
	origin: string,
	now = Date.now()
): Promise<string> {
	const granted = grantableScopes(user).includes(scope) ? scope : 'read';
	const code = generateToken();
	// Codes the app never picked up stay behind otherwise.
	await db
		.delete(oauthCodes)
		.where(and(eq(oauthCodes.userId, user.id), lt(oauthCodes.expiresAt, new Date(now))));
	await db.insert(oauthCodes).values({
		id: await hashToken(code),
		clientId: request.client.id,
		userId: user.id,
		scope: granted,
		redirectUri: request.redirectUri,
		codeChallenge: request.codeChallenge,
		expiresAt: new Date(now + CODE_LIFETIME)
	});
	return redirectWith(request.redirectUri, { code, state: request.state }, origin);
}

/** The URI that tells the app the user declined. */
export function deny(request: AuthorizationRequest, origin: string): string {
	return redirectWith(
		request.redirectUri,
		{ error: 'access_denied', error_description: 'The user declined.', state: request.state },
		origin
	);
}

export type TokenResponse = {
	access_token: string;
	token_type: 'Bearer';
	expires_in: number;
	refresh_token: string;
	scope: ApiKeyScope;
};

/** The base64url SHA-256 of the verifier, which has to match the challenge (RFC 7636). */
async function challengeOf(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

const scopeLabels: Record<ApiKeyScope, string> = { read: 'Lesen', write: 'Lesen und Schreiben' };

async function newTokens(now: number) {
	const accessToken = `${API_KEY_PREFIX}${generateToken()}`;
	const refreshToken = `${REFRESH_PREFIX}${generateToken()}`;
	return {
		accessToken,
		refreshToken,
		row: {
			id: await hashToken(accessToken),
			prefix: accessToken.slice(0, API_KEY_PREFIX.length + 6),
			refreshHash: await hashToken(refreshToken),
			accessExpiresAt: new Date(now + ACCESS_TOKEN_LIFETIME),
			expiresAt: new Date(now + REFRESH_TOKEN_LIFETIME)
		}
	};
}

function tokenResponse(accessToken: string, refreshToken: string, scope: ApiKeyScope) {
	return {
		access_token: accessToken,
		token_type: 'Bearer' as const,
		expires_in: ACCESS_TOKEN_LIFETIME / 1000,
		refresh_token: refreshToken,
		scope
	};
}

const invalidGrant = (message: string) => new OAuthError('invalid_grant', message);

/** The token endpoint: a code for the first tokens, or a refresh token for new ones. */
export async function exchangeToken(
	db: Database,
	form: URLSearchParams,
	now = Date.now()
): Promise<TokenResponse> {
	const grantType = form.get('grant_type');
	if (grantType === 'authorization_code') return exchangeCode(db, form, now);
	if (grantType === 'refresh_token') return refresh(db, form, now);
	throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

function required(form: URLSearchParams, name: string): string {
	const value = form.get(name);
	if (!value) throw new OAuthError('invalid_request', `${name} is missing.`);
	return value;
}

async function exchangeCode(
	db: Database,
	form: URLSearchParams,
	now: number
): Promise<TokenResponse> {
	const codeHash = await hashToken(required(form, 'code'));
	const verifier = required(form, 'code_verifier');
	const clientId = required(form, 'client_id');
	// A code is used once: it is deleted before it is checked, so a second try finds nothing.
	const [code] = await db.delete(oauthCodes).where(eq(oauthCodes.id, codeHash)).returning();
	if (!code || code.expiresAt.getTime() <= now) {
		throw invalidGrant('The code is unknown, used or expired.');
	}
	if (code.clientId !== clientId) throw invalidGrant('The code was issued to another client.');
	const redirectUri = form.get('redirect_uri');
	if (redirectUri && redirectUri !== code.redirectUri) {
		throw invalidGrant('redirect_uri differs from the one of the authorization request.');
	}
	if ((await challengeOf(verifier)) !== code.codeChallenge) {
		throw invalidGrant('code_verifier does not match the code_challenge.');
	}
	const [row] = await db
		.select({ accountId: users.accountId, role: users.role, client: oauthClients.name })
		.from(users)
		.innerJoin(oauthClients, eq(oauthClients.id, code.clientId))
		.where(eq(users.id, code.userId));
	if (!row) throw invalidGrant('The user or the client no longer exists.');
	const scope = row.role === 'viewer' ? 'read' : code.scope;
	const tokens = await newTokens(now);
	await runBatch(db, [
		db.insert(apiKeys).values({
			...tokens.row,
			accountId: row.accountId,
			userId: code.userId,
			clientId: code.clientId,
			name: row.client,
			scope
		}),
		auditEntry(
			db,
			{ accountId: row.accountId, userId: code.userId },
			'api_key',
			tokens.row.id,
			'create',
			`„${row.client}“ verbunden (${scopeLabels[scope]})`
		)
	]);
	return tokenResponse(tokens.accessToken, tokens.refreshToken, scope);
}

async function refresh(db: Database, form: URLSearchParams, now: number): Promise<TokenResponse> {
	const refreshHash = await hashToken(required(form, 'refresh_token'));
	const clientId = form.get('client_id');
	const [grant] = await db.select().from(apiKeys).where(eq(apiKeys.refreshHash, refreshHash));
	if (!grant || grant.expiresAt.getTime() <= now) {
		throw invalidGrant('The refresh token is unknown, revoked or expired.');
	}
	if (clientId && grant.clientId !== clientId) {
		throw invalidGrant('The refresh token was issued to another client.');
	}
	// Both tokens are replaced, the old refresh token is no longer valid (rotation, OAuth 2.1).
	const tokens = await newTokens(now);
	const [updated] = await db
		.update(apiKeys)
		.set(tokens.row)
		.where(and(eq(apiKeys.id, grant.id), eq(apiKeys.refreshHash, refreshHash)))
		.returning({ scope: apiKeys.scope });
	if (!updated) throw invalidGrant('The refresh token was used already.');
	return tokenResponse(tokens.accessToken, tokens.refreshToken, updated.scope);
}
