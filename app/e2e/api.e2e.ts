import { expect, request, test } from '@playwright/test';
import { seedForeignLease, seedLease } from './seed';

// The owner creates an API key on its settings page; a client without the browser's cookies then
// reads through the REST API and the MCP server with it, and the key is revoked again. A key that
// may write adds a task through the MCP server.

const suffix = crypto.randomUUID().slice(0, 6);
const keyName = `Claude ${suffix}`;

test('creates an API key, reads with it through REST and MCP, and revokes it', async ({
	page,
	baseURL
}) => {
	const own = await seedLease(page.request, { property: { name: `API-Haus ${suffix}` } });
	const foreign = await seedForeignLease(page.request);

	await page.goto('/einstellungen/ki-assistenten');
	await expect(page.getByRole('heading', { level: 1, name: 'KI-Assistenten' })).toBeVisible();
	await page.getByLabel('Name').fill(keyName);
	await page.getByRole('button', { name: 'Schlüssel anlegen' }).click();
	const shown = page.locator('.created .key code');
	await expect(shown).toHaveText(/^mk_[\w-]{43}$/);
	const key = (await shown.textContent())!;
	await expect(
		page.getByText(`claude mcp add --transport http mietkartei ${baseURL}/mcp`)
	).toBeVisible();
	const row = page
		.getByRole('table', { name: 'API-Schlüssel' })
		.getByRole('row', { name: keyName });
	await expect(row).toContainText('Nur lesen');
	await expect(row).toContainText(key.slice(0, 9));

	// A client of its own: no session cookie, only the key (and the client address the server
	// reads, see playwright.config.ts).
	const client = await request.newContext({
		baseURL,
		extraHTTPHeaders: { authorization: `Bearer ${key}`, 'cf-connecting-ip': '192.0.2.7' }
	});
	const leases = await client.get('/api/v1/leases');
	expect(leases.status()).toBe(200);
	const ids = ((await leases.json()).data as { id: string }[]).map((lease) => lease.id);
	expect(ids).toContain(own.leaseId);
	expect(ids).not.toContain(foreign.leaseId);
	expect((await client.get(`/api/v1/leases/${foreign.leaseId}`)).status()).toBe(404);

	const rpc = (body: Record<string, unknown>) =>
		client.post('/mcp', {
			data: { jsonrpc: '2.0', ...body },
			headers: { accept: 'application/json, text/event-stream' }
		});
	const init = await rpc({
		id: 1,
		method: 'initialize',
		params: { protocolVersion: '2025-06-18' }
	});
	expect(await init.json()).toMatchObject({ result: { serverInfo: { name: 'mietkartei' } } });
	expect((await rpc({ method: 'notifications/initialized' })).status()).toBe(202);
	const called = await rpc({
		id: 2,
		method: 'tools/call',
		params: { name: 'get_lease', arguments: { id: own.leaseId } }
	});
	const result = (await called.json()).result;
	expect(result.isError).toBeUndefined();
	expect(JSON.parse(result.content[0].text)).toMatchObject({ id: own.leaseId, baseRent: 60000 });

	// The browser's session alone does not open the API.
	expect((await page.request.get('/api/v1/leases')).status()).toBe(401);

	page.once('dialog', (dialog) => dialog.accept());
	await row.getByRole('button', { name: 'Widerrufen' }).click();
	await expect(page.getByText('Der Zugriff wurde widerrufen.')).toBeVisible();
	expect((await client.get('/api/v1/leases')).status()).toBe(401);
	await client.dispose();
});

test('lets an assistant with a write key add a task that the page then shows', async ({
	page,
	baseURL
}) => {
	const title = `Rauchmelder prüfen ${suffix}`;
	await page.goto('/einstellungen/ki-assistenten');
	await page.getByLabel('Name').fill(`Schreiben ${suffix}`);
	await page.getByLabel('Rechte').selectOption({ label: 'Lesen und schreiben' });
	await page.getByRole('button', { name: 'Schlüssel anlegen' }).click();
	const key = (await page.locator('.created .key code').textContent())!;

	const client = await request.newContext({
		baseURL,
		extraHTTPHeaders: { authorization: `Bearer ${key}`, 'cf-connecting-ip': '192.0.2.7' }
	});
	const called = await client.post('/mcp', {
		data: {
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name: 'create_task', arguments: { title, dueDate: '2030-01-15' } }
		}
	});
	expect((await called.json()).result.isError).toBeUndefined();
	await client.dispose();

	await page.goto('/aufgaben');
	await expect(page.getByRole('list', { name: 'Offene Aufgaben' })).toContainText(title);
});
