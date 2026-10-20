import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from './auth';
import type { Database } from './db';
import {
	costCategories,
	leasePersons,
	leaseTenants,
	leases,
	outbox,
	properties,
	rentChanges,
	tenants,
	units,
	users
} from './db/schema';
import { seed, type SeedLeaseResult } from './e2e-seed';
import { testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

describe('seed lease', () => {
	it('creates property, unit, tenant and lease in the first user’s account', async () => {
		const result = await seed(db, { op: 'lease' });
		expect(result.status).toBe(200);
		const { propertyId, unitId, tenantId, leaseId } = result.body as SeedLeaseResult;

		const [property] = await db.select().from(properties).where(eq(properties.id, propertyId));
		expect(property).toMatchObject({ accountId: 'a', city: 'Berlin' });
		expect(property.name).toMatch(/^Testhaus [0-9a-f]{4}$/);

		const [unit] = await db.select().from(units).where(eq(units.id, unitId));
		expect(unit).toMatchObject({ accountId: 'a', propertyId, kind: 'apartment', floorArea: 64 });

		const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
		expect(tenant).toMatchObject({ accountId: 'a', firstName: 'Erika' });
		expect(tenant.lastName).toMatch(/^Muster-[0-9a-f]{4}$/);

		const [lease] = await db.select().from(leases).where(eq(leases.id, leaseId));
		expect(lease).toMatchObject({
			accountId: 'a',
			unitId,
			startDate: '2025-01-01',
			baseRent: 60000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			securityDeposit: 180000,
			persons: 2
		});
		expect(await db.select().from(leaseTenants)).toEqual([{ leaseId, tenantId }]);

		const history = await db.select().from(rentChanges).where(eq(rentChanges.leaseId, leaseId));
		expect(history).toHaveLength(1);
		expect(history[0]).toMatchObject({
			accountId: 'a',
			validFrom: '2025-01-01',
			baseRent: 60000,
			reason: 'initial',
			status: 'approved',
			createdBy: 'user-a'
		});
		const persons = await db.select().from(leasePersons).where(eq(leasePersons.leaseId, leaseId));
		expect(persons).toMatchObject([{ accountId: 'a', persons: 2 }]);
	});

	it('applies overrides and keeps names distinct between calls', async () => {
		const first = await seed(db, {
			op: 'lease',
			property: { name: 'Villa Kunterbunt', accountId: 'b' },
			unit: { name: 'Stellplatz', kind: 'parking', floorArea: null },
			tenant: { lastName: 'Lindgren' },
			lease: { startDate: '2024-06-01', baseRent: 70000, persons: 1 }
		});
		const second = await seed(db, { op: 'lease' });
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		const ids = first.body as SeedLeaseResult;

		const [property] = await db.select().from(properties).where(eq(properties.id, ids.propertyId));
		expect(property).toMatchObject({ accountId: 'a', name: 'Villa Kunterbunt' });
		const [unit] = await db.select().from(units).where(eq(units.id, ids.unitId));
		expect(unit).toMatchObject({ name: 'Stellplatz', kind: 'parking', floorArea: null });
		const [tenant] = await db.select().from(tenants).where(eq(tenants.id, ids.tenantId));
		expect(tenant).toMatchObject({ firstName: 'Erika', lastName: 'Lindgren' });
		const [lease] = await db.select().from(leases).where(eq(leases.id, ids.leaseId));
		expect(lease).toMatchObject({ startDate: '2024-06-01', baseRent: 70000, persons: 1 });

		const names = (await db.select({ name: properties.name }).from(properties)).map((r) => r.name);
		expect(new Set(names).size).toBe(2);
	});

	it('refuses overrides that are not objects', async () => {
		const result = await seed(db, { op: 'lease', lease: 'cheap' });
		expect(result.status).toBe(400);
		expect(await db.select().from(leases)).toEqual([]);
	});
});

describe('seed rows', () => {
	it('inserts into cost_categories with the account forced and returns the ids', async () => {
		const result = await seed(db, {
			op: 'rows',
			table: 'costCategories',
			rows: [
				{ name: 'Wasser', betrkvItem: 2, accountId: 'b' },
				{ id: 'heizung', name: 'Heizung', consumptionBased: true, createdAt: 1700000000000 }
			]
		});
		expect(result).toMatchObject({ status: 200, body: { ids: [expect.any(String), 'heizung'] } });
		const { ids } = result.body as { ids: string[] };

		const rows = await db.select().from(costCategories).orderBy(costCategories.name);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			id: 'heizung',
			accountId: 'a',
			name: 'Heizung',
			consumptionBased: true,
			allocable: true,
			createdAt: new Date(1700000000000)
		});
		expect(rows[1]).toMatchObject({ id: ids[0], accountId: 'a', name: 'Wasser', betrkvItem: 2 });
		expect(await db.select().from(costCategories).where(eq(costCategories.accountId, 'b'))).toEqual(
			[]
		);
	});

	it('accepts the SQL table name and tables without an account', async () => {
		const result = await seed(db, {
			op: 'rows',
			table: 'outbox',
			rows: [{ to: 'a@example.org', subject: 'Hallo', text: 'Welt' }]
		});
		expect(result.status).toBe(200);
		expect(await db.select().from(outbox)).toMatchObject([{ to: 'a@example.org' }]);
	});

	it('refuses unknown tables, unknown columns and malformed rows', async () => {
		expect(await seed(db, { op: 'rows', table: 'nope', rows: [] })).toMatchObject({
			status: 400,
			body: { message: 'Unbekannte Tabelle „nope“.' }
		});
		expect(
			await seed(db, { op: 'rows', table: 'costCategories', rows: [{ nam: 'Wasser' }] })
		).toMatchObject({ status: 400, body: { message: expect.stringContaining('nam') } });
		expect(await seed(db, { op: 'rows', table: 'costCategories', rows: 'x' })).toMatchObject({
			status: 400
		});
		expect(await db.select().from(costCategories)).toEqual([]);
	});

	it('reports a constraint violation instead of throwing', async () => {
		const row = { name: 'Wasser' };
		const result = await seed(db, { op: 'rows', table: 'costCategories', rows: [row, row] });
		expect(result.status).toBe(500);
		expect((result.body as { message: string }).message).toMatch(/UNIQUE/);
	});
});

describe('seed user', () => {
	it('creates a user of the owner’s account whose password verifies', async () => {
		const result = await seed(db, {
			op: 'user',
			email: ' Verwalter@Example.org ',
			password: 'ein-sicheres-passwort',
			role: 'manager',
			name: 'Max Verwalter'
		});
		expect(result.status).toBe(200);
		const { id } = result.body as { id: string };

		const [user] = await db.select().from(users).where(eq(users.id, id));
		expect(user).toMatchObject({
			accountId: 'a',
			email: 'verwalter@example.org',
			role: 'manager',
			name: 'Max Verwalter'
		});
		expect(await verifyPassword('ein-sicheres-passwort', user.passwordHash)).toBe(true);
		expect(await verifyPassword('falsch', user.passwordHash)).toBe(false);
	});

	it('refuses a taken address and an unknown role', async () => {
		expect(
			await seed(db, { op: 'user', email: 'a@example.org', password: 'x', role: 'owner' })
		).toMatchObject({ status: 400 });
		expect(
			await seed(db, { op: 'user', email: 'c@example.org', password: 'x', role: 'admin' })
		).toMatchObject({ status: 400 });
		expect(await db.select().from(users)).toHaveLength(2);
	});
});

describe('seed clear', () => {
	it('removes only the owner’s rows of the named tables', async () => {
		await db.insert(costCategories).values([
			{ accountId: 'a', name: 'Wasser' },
			{ accountId: 'a', name: 'Heizung' },
			{ accountId: 'b', name: 'Wasser' }
		]);
		const lease = (await seed(db, { op: 'lease' })).body as SeedLeaseResult;

		const result = await seed(db, { op: 'clear', tables: ['leases', 'cost_categories'] });
		expect(result.status).toBe(200);
		expect(await db.select().from(costCategories)).toMatchObject([{ accountId: 'b' }]);
		expect(await db.select().from(leases)).toEqual([]);
		expect(await db.select().from(rentChanges)).toEqual([]);
		// Tables not named stay as they are.
		expect(await db.select().from(tenants).where(eq(tenants.id, lease.tenantId))).toHaveLength(1);
	});

	it('refuses tables without an account and unknown tables without deleting anything', async () => {
		await db.insert(costCategories).values({ accountId: 'a', name: 'Wasser' });
		expect(await seed(db, { op: 'clear', tables: ['costCategories', 'outbox'] })).toMatchObject({
			status: 400,
			body: { message: 'Die Tabelle „outbox“ gehört zu keinem Konto.' }
		});
		expect(await seed(db, { op: 'clear', tables: ['costCategories', 'nope'] })).toMatchObject({
			status: 400
		});
		expect(await db.select().from(costCategories)).toHaveLength(1);
	});
});

describe('seed', () => {
	it('refuses an unknown op and a body that is no object', async () => {
		expect(await seed(db, { op: 'drop' })).toMatchObject({
			status: 400,
			body: { message: expect.stringContaining('Unbekannte Operation') }
		});
		expect(await seed(db, 'lease')).toMatchObject({ status: 400 });
		expect(await seed(db, null)).toMatchObject({ status: 400 });
	});

	it('falls back to the default account while no user exists', async () => {
		await db.delete(users);
		const result = await seed(db, {
			op: 'rows',
			table: 'costCategories',
			rows: [{ name: 'Wasser' }]
		});
		expect(result.status).toBe(200);
		expect(await db.select().from(costCategories)).toMatchObject([{ accountId: 'default' }]);
	});
});
