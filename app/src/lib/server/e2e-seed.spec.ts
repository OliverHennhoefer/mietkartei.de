import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { validateSession, verifyPassword } from './auth';
import type { Database } from './db';
import {
	auditLog,
	consumerPriceIndex,
	leasePersons,
	leaseTenants,
	leases,
	properties,
	rentChanges,
	tenants,
	units,
	users
} from './db/schema';
import { FOREIGN_ACCOUNT_ID, seed, type SeedLeaseResult } from './e2e-seed';
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
			endDate: null,
			baseRent: 60000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			securityDeposit: 180000,
			persons: 2
		});
		expect(await db.select().from(leaseTenants)).toEqual([
			{ leaseId, tenantId, joinedOn: null, leftOn: null }
		]);

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
			lease: { startDate: '2024-06-01', endDate: '2024-12-31', baseRent: 70000, persons: 1 }
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
		expect(lease).toMatchObject({
			startDate: '2024-06-01',
			endDate: '2024-12-31',
			baseRent: 70000,
			persons: 1
		});

		const names = (await db.select({ name: properties.name }).from(properties)).map((r) => r.name);
		expect(new Set(names).size).toBe(2);
	});

	it('refuses overrides that are not objects', async () => {
		const result = await seed(db, { op: 'lease', lease: 'cheap' });
		expect(result.status).toBe(400);
		expect(await db.select().from(leases)).toEqual([]);
	});

	it('reports a failed insert and leaves nothing behind', async () => {
		const result = await seed(db, { op: 'lease', unit: { kind: 'cellar', name: null } });
		expect(result.status).toBe(500);
		expect(await db.select().from(properties)).toEqual([]);
		expect(await db.select().from(rentChanges)).toEqual([]);
	});
});

describe('seed foreignLease', () => {
	it('creates a lease in a second account, the same one on every call', async () => {
		const first = (await seed(db, { op: 'foreignLease' })).body as SeedLeaseResult;
		const second = (await seed(db, { op: 'foreignLease' })).body as SeedLeaseResult;
		const rows = await db.select().from(leases);
		const accountOf = (id: string) => rows.find((row) => row.id === id)?.accountId;
		expect(accountOf(first.leaseId)).toBe(FOREIGN_ACCOUNT_ID);
		expect(accountOf(second.leaseId)).toBe(FOREIGN_ACCOUNT_ID);
		const [property] = await db
			.select()
			.from(properties)
			.where(eq(properties.id, first.propertyId));
		expect(property.accountId).toBe(FOREIGN_ACCOUNT_ID);
		expect(FOREIGN_ACCOUNT_ID).not.toBe('a');
	});
});

describe('seed rows', () => {
	it('inserts with the account forced and returns the ids', async () => {
		const { propertyId } = (await seed(db, { op: 'lease' })).body as SeedLeaseResult;
		const result = await seed(db, {
			op: 'rows',
			table: 'units',
			rows: [
				{ propertyId, name: 'OG', kind: 'apartment', accountId: 'b' },
				{ id: 'garage', propertyId, name: 'Garage', kind: 'parking', createdAt: 1700000000000 }
			]
		});
		expect(result).toMatchObject({ status: 200, body: { ids: [expect.any(String), 'garage'] } });
		const { ids } = result.body as { ids: string[] };

		const [garage] = await db.select().from(units).where(eq(units.id, 'garage'));
		expect(garage).toMatchObject({
			accountId: 'a',
			name: 'Garage',
			floorArea: null,
			createdAt: new Date(1700000000000)
		});
		const [og] = await db.select().from(units).where(eq(units.id, ids[0]));
		expect(og).toMatchObject({ accountId: 'a', name: 'OG' });
	});

	it('accepts the SQL table name and tables without an id', async () => {
		const { leaseId } = (await seed(db, { op: 'lease' })).body as SeedLeaseResult;
		const {
			body: { ids }
		} = (await seed(db, {
			op: 'rows',
			table: 'tenants',
			rows: [{ firstName: 'Max', lastName: 'Beispiel' }]
		})) as { body: { ids: string[] } };
		const result = await seed(db, {
			op: 'rows',
			table: 'lease_tenants',
			rows: [{ leaseId, tenantId: ids[0] }]
		});
		expect(result).toEqual({ status: 200, body: { ids: [] } });
		expect(
			await db.select().from(leaseTenants).where(eq(leaseTenants.leaseId, leaseId))
		).toHaveLength(2);
	});

	it('splits large inserts below the parameter limit of D1', async () => {
		const { propertyId } = (await seed(db, { op: 'lease' })).body as SeedLeaseResult;
		const rows = Array.from({ length: 25 }, (_, index) => ({
			propertyId,
			name: `Stellplatz ${index + 1}`,
			kind: 'parking'
		}));
		const result = await seed(db, { op: 'rows', table: 'units', rows });
		expect((result.body as { ids: string[] }).ids).toHaveLength(25);
		expect(await db.select().from(units).where(eq(units.propertyId, propertyId))).toHaveLength(26);
	});

	it('refuses unknown tables, unknown columns and malformed rows', async () => {
		expect(await seed(db, { op: 'rows', table: 'nope', rows: [] })).toMatchObject({
			status: 400,
			body: { message: 'Unbekannte Tabelle „nope“.' }
		});
		expect(
			await seed(db, { op: 'rows', table: 'tenants', rows: [{ fistName: 'Max' }] })
		).toMatchObject({ status: 400, body: { message: expect.stringContaining('fistName') } });
		expect(await seed(db, { op: 'rows', table: 'tenants', rows: 'x' })).toMatchObject({
			status: 400
		});
		expect(await db.select().from(tenants)).toEqual([]);
	});

	it('reports a constraint violation instead of throwing', async () => {
		const row = { id: 'same', firstName: 'Max', lastName: 'Beispiel' };
		const result = await seed(db, { op: 'rows', table: 'tenants', rows: [row, row] });
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
		for (const body of [
			{ email: ' ', password: 'x', role: 'owner' },
			{ email: 'c@example.org', password: '', role: 'owner' },
			{ email: 'c@example.org', password: 'x', role: 'manager', name: 42 }
		]) {
			expect(await seed(db, { op: 'user', ...body }), JSON.stringify(body)).toMatchObject({
				status: 400
			});
		}
		expect(await db.select().from(users)).toHaveLength(2);
	});
});

describe('seed session', () => {
	it('signs a user of the owner’s account in and refuses other users', async () => {
		const { id } = (
			await seed(db, {
				op: 'user',
				email: 'verwalter@example.org',
				password: 'ein-sicheres-passwort',
				role: 'manager'
			})
		).body as { id: string };
		const result = await seed(db, { op: 'session', userId: id });
		expect(result.status).toBe(200);
		const { token } = result.body as { token: string };
		expect((await validateSession(db, token))?.user).toMatchObject({ id, role: 'manager' });

		expect(await seed(db, { op: 'session', userId: 'user-b' })).toMatchObject({ status: 400 });
		expect(await seed(db, { op: 'session' })).toMatchObject({ status: 400 });
	});
});

describe('seed clear', () => {
	const entry = (accountId: string) => ({
		accountId,
		entity: 'task',
		entityId: 't',
		action: 'create',
		summary: 'Aufgabe angelegt'
	});

	it('removes only the owner’s rows of the named tables and empties the VPI table', async () => {
		await db.insert(auditLog).values([entry('a'), entry('a'), entry('b')]);
		await db.insert(consumerPriceIndex).values({ month: '2025-01', value: 121, baseYear: '2020' });
		const lease = (await seed(db, { op: 'lease' })).body as SeedLeaseResult;

		const result = await seed(db, {
			op: 'clear',
			tables: ['leases', 'audit_log', 'consumer_price_index']
		});
		expect(result.status).toBe(200);
		expect(await db.select().from(auditLog)).toMatchObject([{ accountId: 'b' }]);
		expect(await db.select().from(consumerPriceIndex)).toEqual([]);
		expect(await db.select().from(leases)).toEqual([]);
		expect(await db.select().from(rentChanges)).toEqual([]);
		// Tables not named stay as they are.
		expect(await db.select().from(tenants).where(eq(tenants.id, lease.tenantId))).toHaveLength(1);
	});

	it('refuses tables without an account and unknown tables without deleting anything', async () => {
		await db.insert(auditLog).values(entry('a'));
		expect(await seed(db, { op: 'clear', tables: ['auditLog', 'sessions'] })).toMatchObject({
			status: 400,
			body: { message: 'Die Tabelle „sessions“ gehört zu keinem Konto.' }
		});
		expect(await seed(db, { op: 'clear', tables: ['auditLog', 'nope'] })).toMatchObject({
			status: 400
		});
		expect(await seed(db, { op: 'clear', tables: 'auditLog' })).toMatchObject({
			status: 400,
			body: { message: 'Bitte gib die Tabellen als Liste von Namen an.' }
		});
		expect(await db.select().from(auditLog)).toHaveLength(1);
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
			table: 'tenants',
			rows: [{ firstName: 'Max', lastName: 'Beispiel' }]
		});
		expect(result.status).toBe(200);
		expect(await db.select().from(tenants)).toMatchObject([{ accountId: 'default' }]);
	});
});
