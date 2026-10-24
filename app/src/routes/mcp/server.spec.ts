import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiKey } from '#lib/server/api-keys.ts';
import type { Database } from '#lib/server/db/index.ts';
import { contextA, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { DELETE, GET, POST } from './+server';

vi.mock('$app/env/private', () => ({
	BILLING_REQUIRED: false,
	STRIPE_SECRET_KEY: '',
	GENESIS_API_TOKEN: ''
}));

let db: Database;
let key: string;

beforeEach(async () => {
	db = await testDatabase();
	const created = await createApiKey(db, contextA, {
		name: 'Claude',
		scope: 'read',
		lifetimeDays: 30
	});
	if (!created.ok) throw new Error(created.reason);
	key = created.key;
});

async function post(body: string, headers: Record<string, string> = {}) {
	const url = new URL('/mcp', 'http://localhost');
	const request = new Request(url, {
		method: 'POST',
		headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...headers },
		body
	});
	const event = {
		request,
		url,
		locals: { db, user: undefined },
		getClientAddress: () => '10.0.0.2'
	};
	return POST(event as never);
}

describe('/mcp', () => {
	it('answers a JSON-RPC request with JSON', async () => {
		await seedUnit(db, 'a', { propertyName: 'Lindenhaus' });
		const response = await post(
			JSON.stringify({
				jsonrpc: '2.0',
				id: 7,
				method: 'tools/call',
				params: { name: 'list_properties', arguments: {} }
			})
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		const answer = await response.json();
		expect(answer.id).toBe(7);
		expect(JSON.parse(answer.result.content[0].text)).toMatchObject([{ name: 'Lindenhaus' }]);
	});

	it('accepts notifications with 202 and no body', async () => {
		const response = await post(
			JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
		);
		expect(response.status).toBe(202);
		expect(await response.text()).toBe('');
	});

	it('answers a body that is not JSON with a parse error', async () => {
		const response = await post('{"jsonrpc":');
		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe(-32700);
	});

	it('refuses requests without a key and from other origins', async () => {
		expect((await post('{}', { authorization: '' })).status).toBe(401);
		const foreign = await post('{}', { origin: 'https://evil.example' });
		expect(foreign.status).toBe(403);
		expect(
			(
				await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), {
					origin: 'http://localhost'
				})
			).status
		).toBe(200);
	});

	it('refuses bodies over 64 KB', async () => {
		expect((await post(' '.repeat(70 * 1024))).status).toBe(413);
		// A declared length over the limit is refused before the body is read.
		expect((await post('{}', { 'content-length': String(1024 * 1024) })).status).toBe(413);
	});

	it('offers no event stream', async () => {
		expect((await GET({} as never)).status).toBe(405);
		expect((await DELETE({} as never)).status).toBe(405);
	});
});
