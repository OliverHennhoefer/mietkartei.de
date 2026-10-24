import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiCaller } from '../api-keys';
import type { Database } from '../db';
import { ownerA, seedUnit, testDatabase } from '../testing';
import { handleMessage, listTools, PROTOCOL_VERSIONS } from './mcp';
import { operations } from './operations';

vi.mock('$app/env/private', () => ({ BILLING_REQUIRED: false, STRIPE_SECRET_KEY: '' }));

let db: Database;
const reader: ApiCaller = { user: ownerA, scope: 'read', keyId: 'key-a' };

beforeEach(async () => {
	db = await testDatabase();
});

const call = (method: string, params?: unknown) =>
	handleMessage(db, reader, { jsonrpc: '2.0', id: 1, method, params });

describe('handleMessage', () => {
	it('answers initialize with the requested or the newest protocol version', async () => {
		expect(await call('initialize', { protocolVersion: '2025-03-26' })).toMatchObject({
			jsonrpc: '2.0',
			id: 1,
			result: {
				protocolVersion: '2025-03-26',
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: 'mietkartei' }
			}
		});
		expect(await call('initialize', { protocolVersion: '1999-01-01' })).toMatchObject({
			result: { protocolVersion: PROTOCOL_VERSIONS[0] }
		});
	});

	it('answers ping and gives notifications no answer', async () => {
		expect(await call('ping')).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
		expect(
			await handleMessage(db, reader, { jsonrpc: '2.0', method: 'notifications/initialized' })
		).toBeUndefined();
	});

	it('lists the tools with their input schema', async () => {
		const result = (await call('tools/list')) as { result: { tools: { name: string }[] } };
		expect(result.result.tools.map((tool) => tool.name)).toEqual(
			operations
				.filter((operation) => operation.scope === 'read')
				.map((operation) => operation.name)
		);
		expect(listTools(reader)[0]).toMatchObject({
			name: 'list_properties',
			inputSchema: { type: 'object', properties: {} },
			annotations: { readOnlyHint: true, destructiveHint: false }
		});
	});

	it('lists the writing tools only for a write key', async () => {
		const names = (caller: ApiCaller) => listTools(caller).map((tool) => tool.name);
		expect(names(reader)).not.toContain('record_payment');
		expect(names({ ...reader, scope: 'write' })).toContain('record_payment');
		const create = listTools({ ...reader, scope: 'write' }).find(
			(tool) => tool.name === 'create_task'
		);
		expect(create?.annotations.readOnlyHint).toBe(false);
		expect(
			await call('tools/call', { name: 'create_task', arguments: { title: 'x' } })
		).toMatchObject({ error: { code: -32602 } });
	});

	it('calls a tool with the data of the key’s account only', async () => {
		await seedUnit(db, 'a', { propertyName: 'Lindenhaus' });
		await seedUnit(db, 'b', { propertyName: 'Fremdes Haus' });
		const answer = (await call('tools/call', { name: 'list_properties', arguments: {} })) as {
			result: {
				content: { type: string; text: string }[];
				structuredContent: { items: unknown[] };
			};
		};
		const items = JSON.parse(answer.result.content[0].text);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ name: 'Lindenhaus', unitCount: 1, vacantUnits: 1 });
		expect(items[0]).not.toHaveProperty('accountId');
		expect(answer.result.structuredContent.items).toEqual(items);
	});

	it('reports failures of a tool as its result, for the model to read', async () => {
		const { propertyId } = await seedUnit(db, 'b');
		expect(
			await call('tools/call', { name: 'get_property', arguments: { id: propertyId } })
		).toMatchObject({ result: { isError: true, content: [{ text: 'Property not found.' }] } });
		expect(await call('tools/call', { name: 'get_property', arguments: {} })).toMatchObject({
			result: { isError: true, content: [{ text: 'Missing parameter "id".' }] }
		});
	});

	it('refuses unknown tools, methods and malformed messages', async () => {
		expect(await call('tools/call', { name: 'drop_database' })).toMatchObject({
			error: { code: -32602 }
		});
		expect(await call('resources/list')).toMatchObject({ error: { code: -32601 } });
		expect(await handleMessage(db, reader, [])).toMatchObject({
			id: null,
			error: { code: -32600 }
		});
		expect(await handleMessage(db, reader, { id: 3, method: 'ping' })).toMatchObject({
			id: 3,
			error: { code: -32600 }
		});
	});
});
