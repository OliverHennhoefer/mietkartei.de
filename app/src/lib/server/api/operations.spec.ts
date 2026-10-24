import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiCaller } from '../api-keys';
import { listAuditLog } from '../audit';
import type { Database } from '../db';
import { accounts } from '../db/schema';
import { createExpense } from '../expenses';
import { createPayment, listLedger } from '../ledger';
import { QUOTAS } from '../quotas';
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
	STRIPE_PRICE_ID: '',
	FREE_ACCOUNT_EMAILS: '',
	GENESIS_API_TOKEN: ''
}));
vi.mock('$app/env/private', () => env);

let db: Database;
const reader: ApiCaller = { user: ownerA, scope: 'read', keyId: 'key-a' };
const writer: ApiCaller = { ...reader, scope: 'write' };
let ids: { propertyId: string; unitId: string; tenantId: string; leaseId: string };

beforeEach(async () => {
	Object.assign(env, { BILLING_REQUIRED: false, STRIPE_SECRET_KEY: '', STRIPE_PRICE_ID: '' });
	db = await testDatabase();
	const { propertyId, unitId } = await seedUnit(db, 'a');
	const tenantId = await seedTenant(db, 'a');
	const leaseId = await seedLease(db, 'a', unitId, { tenantIds: [tenantId] });
	ids = { propertyId, unitId, tenantId, leaseId };
	await seedCostItem(db, 'a', propertyId);
	await createTask(db, contextA, {
		title: 'Rauchmelder prüfen',
		category: 'other',
		dueDate: '2026-03-01',
		repeatMonths: null,
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
		expect(await run('list_leases', { status: 'active' })).toHaveLength(1);
		expect(await run('list_leases', { status: 'ended' })).toEqual([]);
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
		expect(await run('list_tasks', { status: 'all' })).toHaveLength(1);
	});

	it('return the dunning state, the expenses and the analysis', async () => {
		const state = (await run('get_reminder_state', { id: ids.leaseId })) as {
			items: { open: number }[];
			overdue: number;
			reminders: unknown[];
			suggestedLevel: number;
		};
		expect(state.overdue).toBeGreaterThan(0);
		expect(state.overdue).toBe(state.items.reduce((sum, item) => sum + item.open, 0));
		expect(state).toMatchObject({ reminders: [], suggestedLevel: 1 });

		await createExpense(db, contextA, {
			date: '2025-03-05',
			amount: 125000,
			category: 'maintenance',
			scope: { kind: 'unit', id: ids.unitId },
			description: 'Bad'
		});
		expect(await run('list_expenses', { from: '2025-01-01' })).toMatchObject([
			{ description: 'Bad', amount: 125000, scopeLabel: 'EG links · Haus' }
		]);
		expect(await run('list_expenses', { to: '2024-12-31' })).toEqual([]);

		const year = (await run('get_analysis', { year: 2025 })) as {
			totals: { expenses: number; charged: number };
			series: unknown[];
		};
		expect(year.totals.expenses).toBe(125000);
		expect(year.totals.charged).toBeGreaterThan(0);
		expect(year.series).toHaveLength(12);
		const all = (await run('get_analysis', { allYears: true })) as { totals: { expenses: number } };
		expect(all.totals.expenses).toBe(125000);
		// Without a year, the current one; another property's figures stay out.
		const current = (await run('get_analysis', { propertyId: 'other' })) as {
			totals: { expenses: number; charged: number };
		};
		expect(current.totals).toMatchObject({ expenses: 0, charged: 0 });
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
			['get_reminder_state', otherLease.id],
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

const write = (name: string, input: Record<string, unknown> = {}) =>
	runOperation(db, writer, operationByName.get(name)!, input);

describe('write operations', () => {
	it('are refused to read keys', async () => {
		await expect(
			runOperation(db, reader, operationByName.get('create_task')!, { title: 'x' })
		).rejects.toMatchObject({ status: 403, code: 'forbidden' });
	});

	it('are refused while the account may only read', async () => {
		Object.assign(env, { BILLING_REQUIRED: true, STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_ID: 'p' });
		await db
			.update(accounts)
			.set({ createdAt: new Date('2020-01-01'), subscriptionStatus: 'none' });
		await expect(write('create_task', { title: 'x' })).rejects.toMatchObject({
			status: 403,
			code: 'read_only'
		});
		// Reading goes on.
		expect(await run('list_tasks')).toHaveLength(1);
	});

	it('answer a reached quota as a refusal', async () => {
		const max = QUOTAS.tasks.max;
		QUOTAS.tasks.max = 1;
		try {
			await expect(write('create_task', { title: 'Noch eine' })).rejects.toMatchObject({
				status: 409,
				code: 'refused'
			});
		} finally {
			QUOTAS.tasks.max = max;
		}
	});

	it('book a payment on the rent account, audited under the key’s user', async () => {
		const payment = (await write('record_payment', {
			id: ids.leaseId,
			date: '2025-01-05',
			amount: 80000,
			note: 'Miete Januar'
		})) as { id: string };
		const ledger = await listLedger(db, 'a', ids.leaseId, { to: '2025-01-31' });
		expect(ledger.lines).toContainEqual(
			expect.objectContaining({ kind: 'payment', id: payment.id, amount: 80000 })
		);
		const [entry] = await listAuditLog(db, 'a');
		expect(entry).toMatchObject({ entity: 'lease', userEmail: 'a@example.org' });
		await expect(
			write('record_payment', { id: ids.leaseId, date: '2025-01-05', amount: 0 })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			write('record_payment', { id: 'other', date: '2025-01-05', amount: 100 })
		).rejects.toMatchObject({ status: 404 });
	});

	it('create a task and tick it off, a repeating one with its next copy', async () => {
		const task = (await write('create_task', {
			title: 'Heizung warten',
			category: 'maintenance',
			dueDate: '2026-11-01',
			repeatMonths: 12,
			propertyId: ids.propertyId
		})) as { id: string; property: { id: string } };
		expect(task).toMatchObject({ title: 'Heizung warten', property: { id: ids.propertyId } });
		expect(await write('complete_task', { id: task.id })).toMatchObject({ done: true });
		await expect(write('complete_task', { id: task.id })).rejects.toMatchObject({ status: 409 });
		const open = (await run('list_tasks')) as { title: string; dueDate: string }[];
		expect(open).toContainEqual(
			expect.objectContaining({ title: 'Heizung warten', dueDate: '2027-11-01' })
		);
	});

	it('refuse invalid tasks', async () => {
		for (const input of [
			{ title: '' },
			{ title: 'x', repeatMonths: 7, dueDate: '2026-01-01' },
			{ title: 'x', repeatMonths: 12 },
			{ title: 'x', propertyId: ids.propertyId, leaseId: ids.leaseId }
		]) {
			await expect(write('create_task', input), JSON.stringify(input)).rejects.toMatchObject({
				status: 400
			});
		}
		expect(await write('create_task', { title: 'x', propertyId: ' ', leaseId: '' })).toMatchObject({
			title: 'x',
			property: null,
			lease: null
		});
		await expect(write('create_task', { title: 'x', leaseId: 'other' })).rejects.toMatchObject({
			status: 404,
			message: expect.stringContaining('Lease')
		});
		await expect(write('create_task', { title: 'x', propertyId: 'other' })).rejects.toMatchObject({
			status: 404,
			message: expect.stringContaining('Property')
		});
		await expect(write('complete_task', { id: 'other' })).rejects.toMatchObject({ status: 404 });
	});

	it('record a cost item with the key of its category', async () => {
		const categories = (await run('list_cost_categories')) as {
			id: string;
			name: string;
			allocationKeyId: string | null;
			allocationKeyName: string | null;
		}[];
		const category = categories.find((row) => row.allocationKeyId)!;
		expect(category.allocationKeyName).toBeTruthy();
		const item = await write('create_cost_item', {
			propertyId: ids.propertyId,
			categoryId: category.id,
			description: 'Versicherung 2026',
			periodStart: '2026-01-01',
			periodEnd: '2026-12-31',
			amount: 45000
		});
		expect(item).toMatchObject({
			categoryId: category.id,
			allocationKeyId: category.allocationKeyId,
			amount: 45000,
			categoryName: category.name
		});
		expect(await run('list_allocation_keys')).not.toEqual([]);
	});

	it('refuse cost items of unknown rows or with a wrong period', async () => {
		const [category] = (await run('list_cost_categories')) as { id: string }[];
		const base = {
			propertyId: ids.propertyId,
			categoryId: category.id,
			description: 'Beleg',
			periodStart: '2026-01-01',
			periodEnd: '2026-12-31',
			amount: 100
		};
		await expect(
			write('create_cost_item', { ...base, periodEnd: '2025-12-31' })
		).rejects.toMatchObject({ status: 400 });
		await expect(write('create_cost_item', { ...base, description: '' })).rejects.toMatchObject({
			status: 400
		});
		const categories = (await run('list_cost_categories')) as {
			id: string;
			allocationKeyId: string | null;
		}[];
		const withoutKey = categories.find((row) => !row.allocationKeyId)!;
		await expect(
			write('create_cost_item', { ...base, categoryId: withoutKey.id })
		).rejects.toMatchObject({ status: 400 });
		await expect(write('create_cost_item', { ...base, propertyId: 'other' })).rejects.toMatchObject(
			{ status: 404 }
		);
		await expect(write('create_cost_item', { ...base, categoryId: 'other' })).rejects.toMatchObject(
			{ status: 404 }
		);
		await expect(
			write('create_cost_item', { ...base, allocationKeyId: 'other' })
		).rejects.toMatchObject({ status: 404 });
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
