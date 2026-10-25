import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { auditLog } from './db/schema';
import { deleteTenant } from './deletion';
import { createTenant, getTenant, listTenants, updateTenant } from './tenants';
import { contextA, contextB, seedLease, seedUnit, tenantInput, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

describe('tenants', () => {
	it('lists only the tenants of the account, sorted by last and first name', async () => {
		await createTenant(db, contextA, tenantInput({ firstName: 'Max', lastName: 'Mustermann' }));
		await createTenant(db, contextA, tenantInput({ firstName: 'Anna', lastName: 'Bauer' }));
		await createTenant(db, contextA, tenantInput({ firstName: 'Erika', lastName: 'Mustermann' }));
		await createTenant(db, contextB, tenantInput({ firstName: 'Fremd', lastName: 'Aal' }));

		const names = (await listTenants(db, 'a')).map((tenant) => tenant.firstName);
		expect(names).toEqual(['Anna', 'Erika', 'Max']);
	});

	it('does not return, update or delete a tenant of another account', async () => {
		const foreign = await createTenant(db, contextB, tenantInput({ firstName: 'Fremd' }));

		expect(await getTenant(db, 'a', foreign.id)).toBeUndefined();
		expect(await updateTenant(db, contextA, foreign.id, tenantInput({ firstName: 'Neu' }))).toBe(
			false
		);
		expect(await deleteTenant(db, contextA, foreign.id)).toBe('missing');
		expect(await getTenant(db, 'b', foreign.id)).toMatchObject({ firstName: 'Fremd' });
	});

	it('updates all fields of a tenant', async () => {
		const tenant = await createTenant(db, contextA, tenantInput());
		const changed = tenantInput({
			salutation: 'Frau',
			email: 'erika@example.org',
			phone: '030 123',
			street: 'Weg 1',
			postalCode: '10115',
			city: 'Berlin',
			notes: 'Zahlt immer pünktlich.'
		});
		expect(await updateTenant(db, contextA, tenant.id, changed)).toBe(true);
		expect(await getTenant(db, 'a', tenant.id)).toMatchObject(changed);
	});

	it('refuses to delete a tenant that is on a lease', async () => {
		const tenant = await createTenant(db, contextA, tenantInput());
		const { unitId } = await seedUnit(db, 'a');
		await seedLease(db, 'a', unitId, { tenantIds: [tenant.id] });

		expect(await deleteTenant(db, contextA, tenant.id)).toBe('in-use');
		expect(await getTenant(db, 'a', tenant.id)).toBeDefined();
	});

	it('deletes a tenant without leases', async () => {
		const tenant = await createTenant(db, contextA, tenantInput());
		expect(await deleteTenant(db, contextA, tenant.id)).toBe('deleted');
		expect(await getTenant(db, 'a', tenant.id)).toBeUndefined();
	});

	it('logs creating, changing and deleting a tenant', async () => {
		const tenant = await createTenant(db, contextA, tenantInput());
		await updateTenant(db, contextA, tenant.id, tenantInput({ lastName: 'Musterfrau' }));
		await deleteTenant(db, contextA, tenant.id);
		const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, tenant.id));
		expect(audit.map((entry) => [entry.userId, entry.action, entry.summary])).toEqual([
			['user-a', 'create', 'Mieter Erika Mustermann angelegt'],
			['user-a', 'update', 'Mieter Erika Musterfrau geändert'],
			['user-a', 'delete', 'Mieter Erika Musterfrau gelöscht']
		]);
	});
});
