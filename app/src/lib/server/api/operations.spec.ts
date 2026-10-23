import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiCaller } from '../api-keys';
import type { Database } from '../db';
import { createPayment } from '../ledger';
import { createTask } from '../tasks';
import {
	contextA,
	ownerA,
	seedCostItem,
	seedLease,
	seedTenant,
	seedUnit,
	testDatabase
} from '../testing';
import { ApiError, operationByName, operations, permits, toJson } from './operations';
import { runOperation } from './request';

const env = vi.hoisted(() => ({
	BILLING_REQUIRED: false,
	STRIPE_SECRET_KEY: '',
	STRIPE_PRICE_ID: ''
}));
vi.mock('$app/env/private', () => env);

let db: Database;
const reader: ApiCaller = { user: ownerA, scope: 'read', keyId: 'key-a' };
let ids: { propertyId: string; unitId: string; tenantId: string; leaseId: string };

beforeEach(async () => {
	db = await testDatabase();
	const { propertyId, unitId } = await seedUnit(db, 'a');
	const tenantId = await seedTenant(db, 'a');
	const leaseId = await seedLease(db, 'a', unitId, { tenantIds: [tenantId] });
	ids = { propertyId, unitId, tenantId, leaseId };
	await seedCostItem(db, 'a', propertyId);
	await createTask(db, contextA, {
		title: 'Rauchmelder prüfen',
		dueDate: '2026-03-01',
		propertyId,
		leaseId: null,
		note: null
	});
	// Account b has the same kinds of rows, none of which may show up for account a.
	const other = await seedUnit(db, 'b', { propertyName: 'Fremd' });
	await seedLease(db, 'b', other.unitId, { tenantIds: [await seedTenant(db, 'b')] });
});

const run = (name: string, input: Record<string, unknown> = {}) =>
	runOperation(db, reader, operationByName.get(name)!, input);

describe('operations', () => {
	it('have unique names and paths', () => {
		expect(new Set(operations.map((operation) => operation.name)).size).toBe(operations.length);
		const routes = operations.map((operation) => `${operation.method} ${operation.path}`);
		expect(new Set(routes).size).toBe(routes.length);
		for (const operation of operations) {
			expect(operation.name).toMatch(/^[a-z_]+$/);
			if (operation.path.includes('{id}')) expect(operation.input.required).toContain('id');
		}
	});

	it('list the account’s properties, tenants and leases', async () => {
		expect(await run('list_properties')).toMatchObject([{ id: ids.propertyId, unitCount: 1 }]);
		expect(await run('list_tenants')).toMatchObject([{ id: ids.tenantId, lastName: 'Mustermann' }]);
		const leases = (await run('list_leases')) as { id: string; tenants: unknown[] }[];
		expect(leases).toHaveLength(1);
		expect(leases[0]).toMatchObject({
			id: ids.leaseId,
			label: 'EG links · Haus',
			tenants: [{ id: ids.tenantId, name: 'Erika Mustermann' }],
			currentRent: { baseRent: 60000 }
		});
		expect(await run('list_leases', { status: 'upcoming' })).toEqual([]);
		expect(await run('list_leases', { tenantId: ids.tenantId })).toHaveLength(1);
	});

	it('return one property, tenant and lease in detail', async () => {
		expect(await run('get_property', { id: ids.propertyId })).toMatchObject({
			units: [{ id: ids.unitId, occupancies: [{ leaseId: ids.leaseId }] }]
		});
		expect(await run('get_tenant', { id: ids.tenantId })).toMatchObject({
			leases: [{ id: ids.leaseId }]
		});
		expect(await run('get_lease', { id: ids.leaseId })).toMatchObject({
			id: ids.leaseId,
			rentChanges: [{ reason: 'initial', baseRent: 60000 }],
			deposit: { outstanding: 180000, movements: [] }
		});
	});

	it('return the rent account and the balances', async () => {
		await createPayment(db, contextA, {
			leaseId: ids.leaseId,
			date: '2025-01-10',
			amount: 80000,
			source: 'manual'
		});
		const ledger = (await run('get_rent_ledger', { id: ids.leaseId, to: '2025-02-28' })) as {
			lines: { kind: string }[];
		};
		expect(ledger.lines.map((line) => line.kind)).toEqual(['charge', 'payment', 'charge']);
		const balances = (await run('list_balances')) as { leaseId: string; label: string }[];
		expect(balances).toHaveLength(1);
		expect(balances[0]).toMatchObject({ leaseId: ids.leaseId, label: 'EG links · Haus' });
	});

	it('list cost items, statements, deadlines and tasks', async () => {
		expect(await run('list_cost_items', { year: 2025 })).toMatchObject([
			{ description: 'Grundsteuer', amount: 60000 }
		]);
		expect(await run('list_cost_items', { year: 2024 })).toEqual([]);
		expect(await run('list_statements')).toEqual([]);
		const deadlines = (await run('list_deadlines')) as Record<string, unknown>[];
		for (const deadline of deadlines) expect(deadline).not.toHaveProperty('href');
		expect(await run('list_tasks')).toMatchObject([{ title: 'Rauchmelder prüfen' }]);
		expect(await run('list_tasks', { status: 'done' })).toEqual([]);
	});

	it('do not find rows of another account', async () => {
		const [otherLease] = (await runOperation(
			db,
			{ ...reader, user: { ...ownerA, id: 'user-b', accountId: 'b' } },
			operationByName.get('list_leases')!,
			{}
		)) as { id: string; propertyId: string; tenants: { id: string }[] }[];
		for (const [name, id] of [
			['get_property', otherLease.propertyId],
			['get_tenant', otherLease.tenants[0].id],
			['get_lease', otherLease.id],
			['get_rent_ledger', otherLease.id],
			['get_statement', otherLease.id]
		]) {
			await expect(run(name, { id }), name).rejects.toMatchObject({ status: 404 });
		}
	});

	it('refuses invalid input', async () => {
		await expect(run('list_cost_items', { year: 'x' })).rejects.toMatchObject({
			status: 400,
			code: 'invalid_input'
		});
		await expect(run('get_lease')).rejects.toThrow(ApiError);
	});
});

describe('permits', () => {
	it('lets write keys do everything and read keys only read', () => {
		const write = { name: 'x', scope: 'write' } as never;
		const read = { name: 'x', scope: 'read' } as never;
		expect(permits(reader, read)).toBe(true);
		expect(permits(reader, write)).toBe(false);
		expect(permits({ ...reader, scope: 'write' }, write)).toBe(true);
	});
});

describe('toJson', () => {
	it('writes dates as ISO strings and drops the account id at every depth', () => {
		expect(
			toJson({ accountId: 'a', at: new Date(0), rows: [{ accountId: 'a', n: 1 }], none: null })
		).toEqual({ at: '1970-01-01T00:00:00.000Z', rows: [{ n: 1 }], none: null });
	});
});
