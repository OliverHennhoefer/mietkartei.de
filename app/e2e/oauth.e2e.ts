import { expect, request, test } from '@playwright/test';
import { watchCspViolations } from './csp';
import { closeLaunchNotice } from './launch-notice';
import { owner } from './owner';

// An assistant such as the claude.ai connector connects by OAuth: it finds the authorization
// server from the 401 of /mcp, registers itself, sends the signed-in owner to the consent page,
// gets the code at its redirect URI and exchanges it for a token that opens the MCP server. The
// owner then disconnects it on the API key page. The redirect URI is this server under another
// origin, so the consent form's redirect to a foreign origin is covered by the CSP as well.

const suffix = crypto.randomUUID().slice(0, 6);
const appName = `Claude ${suffix}`;

async function challengeOf(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return Buffer.from(digest).toString('base64url');
}

test('connects an app by OAuth, which then reads through MCP, and disconnects it', async ({
	page,
	baseURL
}) => {
	const violations = watchCspViolations(page);
	const client = await request.newContext({
		baseURL,
		extraHTTPHeaders: { 'cf-connecting-ip': '192.0.2.8' }
	});

	const unauthorized = await client.post('/mcp', {
		data: { jsonrpc: '2.0', id: 1, method: 'ping' }
	});
	expect(unauthorized.status()).toBe(401);
	const metadataUrl = unauthorized
		.headers()
		['www-authenticate'].match(/resource_metadata="([^"]+)"/)![1];
	const resource = await (await client.get(metadataUrl)).json();
	expect(resource.resource).toBe(`${baseURL}/mcp`);
	const server = await (await client.get('/.well-known/oauth-authorization-server')).json();

	const redirectUri = `${baseURL!.replace('localhost', '127.0.0.1')}/health`;
	const registered = await client.post(server.registration_endpoint, {
		data: { client_name: appName, redirect_uris: [redirectUri] }
	});
	expect(registered.status()).toBe(201);
	const { client_id } = await registered.json();

	const verifier = `${crypto.randomUUID()}${crypto.randomUUID()}`;
	const authorize = new URL(server.authorization_endpoint);
	authorize.search = new URLSearchParams({
		client_id,
		redirect_uri: redirectUri,
		response_type: 'code',
		code_challenge: await challengeOf(verifier),
		code_challenge_method: 'S256',
		state: 'e2e',
		resource: resource.resource
	}).toString();
	await page.goto(authorize.toString());
	await expect(page.getByRole('heading', { level: 1, name: 'Zugriff erlauben' })).toBeVisible();
	await expect(page.getByText(appName)).toBeVisible();
	await page.getByLabel('Rechte').selectOption({ label: 'Lesen und schreiben' });
	await page.getByRole('button', { name: 'Erlauben' }).click();
	await page.waitForURL((url) => url.href.startsWith(redirectUri), { waitUntil: 'commit' });
	const callback = new URL(page.url());
	expect(callback.searchParams.get('state')).toBe('e2e');

	const issued = await client.post(server.token_endpoint, {
		form: {
			grant_type: 'authorization_code',
			code: callback.searchParams.get('code')!,
			client_id,
			redirect_uri: redirectUri,
			code_verifier: verifier
		}
	});
	expect(issued.status()).toBe(200);
	const tokens = await issued.json();
	expect(tokens.scope).toBe('write');

	const listed = await client.post('/mcp', {
		data: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
		headers: { authorization: `Bearer ${tokens.access_token}` }
	});
	const names = (await listed.json()).result.tools.map((tool: { name: string }) => tool.name);
	expect(names).toContain('create_task');

	await page.goto('/einstellungen/ki-assistenten');
	const row = page
		.getByRole('table', { name: 'Verbundene Apps' })
		.getByRole('row', { name: appName });
	await expect(row).toContainText('Lesen und schreiben');
	page.once('dialog', (dialog) => dialog.accept());
	await row.getByRole('button', { name: 'Trennen' }).click();
	await expect(page.getByText('Der Zugriff wurde widerrufen.')).toBeVisible();
	const revoked = await client.post('/mcp', {
		data: { jsonrpc: '2.0', id: 3, method: 'ping' },
		headers: { authorization: `Bearer ${tokens.access_token}` }
	});
	expect(revoked.status()).toBe(401);
	await client.dispose();
	expect(violations).toEqual([]);
});

test('brings a visitor through the sign-in to the consent page and back to the app', async ({
	browser,
	baseURL
}) => {
	const client = await request.newContext({
		baseURL,
		extraHTTPHeaders: { 'cf-connecting-ip': '192.0.2.9' }
	});
	const redirectUri = `${baseURL!.replace('localhost', '127.0.0.1')}/health`;
	const { client_id } = await (
		await client.post('/oauth/register', {
			data: { client_name: `ChatGPT ${suffix}`, redirect_uris: [redirectUri] }
		})
	).json();
	await client.dispose();

	// A browser without a session, as when the app opens the consent page.
	const context = await browser.newContext({
		storageState: { cookies: [], origins: [] },
		extraHTTPHeaders: { 'cf-connecting-ip': '192.0.2.9' }
	});
	const page = await context.newPage();
	await closeLaunchNotice(page);
	const violations = watchCspViolations(page);
	const query = new URLSearchParams({
		client_id,
		redirect_uri: redirectUri,
		response_type: 'code',
		code_challenge: await challengeOf('visitor-verifier-'.repeat(3)),
		code_challenge_method: 'S256',
		state: 'visitor'
	});
	await page.goto(`/oauth/authorize?${query}`);
	await expect(page.getByRole('heading', { level: 1, name: 'Anmelden' })).toBeVisible();
	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Zugriff erlauben' })).toBeVisible();
	await page.getByRole('button', { name: 'Ablehnen' }).click();
	await page.waitForURL((url) => url.href.startsWith(redirectUri), { waitUntil: 'commit' });
	const callback = new URL(page.url());
	expect(callback.searchParams.get('error')).toBe('access_denied');
	expect(callback.searchParams.get('state')).toBe('visitor');
	expect(violations).toEqual([]);
	await context.close();
});
