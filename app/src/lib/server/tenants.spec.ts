import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { createLease } from './leases';
import {
	createTenant,
	deleteTenant,
	findTenants,
	getTenant,
	listTenants,
	updateTenant
} from './tenants';
import { contextA, leaseInput, seedUnit, tenantInput, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

describe('tenants', () => {
	it('lists only the tenants of the account, sorted by last and first name', async () => {
		await createTenant(db, 'a', tenantInput({ firstName: 'Max', lastName: 'Mustermann' }));
		await createTenant(db, 'a', tenantInput({ firstName: 'Anna', lastName: 'Bauer' }));
		await createTenant(db, 'a', tenantInput({ firstName: 'Erika', lastName: 'Mustermann' }));
		await createTenant(db, 'b', tenantInput({ firstName: 'Fremd', lastName: 'Aal' }));

		const names = (await listTenants(db, 'a')).map((tenant) => tenant.firstName);
		expect(names).toEqual(['Anna', 'Erika', 'Max']);
	});

	it('does not return, update or delete a tenant of another account', async () => {
		const foreign = await createTenant(db, 'b', tenantInput({ firstName: 'Fremd' }));

		expect(await getTenant(db, 'a', foreign.id)).toBeUndefined();
		expect(await updateTenant(db, 'a', foreign.id, tenantInput({ firstName: 'Neu' }))).toBe(false);
		expect(await deleteTenant(db, 'a', foreign.id)).toBe('missing');
		expect(await getTenant(db, 'b', foreign.id)).toMatchObject({ firstName: 'Fremd' });
	});

	it('updates all fields of a tenant', async () => {
		const tenant = await createTenant(db, 'a', tenantInput());
		const changed = tenantInput({
			salutation: 'Frau',
			email: 'erika@example.org',
			phone: '030 123',
			street: 'Weg 1',
			postalCode: '10115',
			city: 'Berlin',
			notes: 'Zahlt immer pünktlich.'
		});
		expect(await updateTenant(db, 'a', tenant.id, changed)).toBe(true);
		expect(await getTenant(db, 'a', tenant.id)).toMatchObject(changed);
	});

	it('refuses to delete a tenant that is on a lease', async () => {
		const tenant = await createTenant(db, 'a', tenantInput());
		const { unitId } = await seedUnit(db, 'a');
		const lease = await createLease(db, contextA, leaseInput(unitId, { tenantIds: [tenant.id] }));
		expect(lease.ok).toBe(true);

		expect(await deleteTenant(db, 'a', tenant.id)).toBe('in-use');
		expect(await getTenant(db, 'a', tenant.id)).toBeDefined();
	});

	it('deletes a tenant without leases', async () => {
		const tenant = await createTenant(db, 'a', tenantInput());
		expect(await deleteTenant(db, 'a', tenant.id)).toBe('deleted');
		expect(await getTenant(db, 'a', tenant.id)).toBeUndefined();
	});

	it('finds the given tenants of the account in the order given', async () => {
		const first = await createTenant(db, 'a', tenantInput({ firstName: 'Eins' }));
		const second = await createTenant(db, 'a', tenantInput({ firstName: 'Zwei' }));
		const foreign = await createTenant(db, 'b', tenantInput({ firstName: 'Fremd' }));

		const found = await findTenants(db, 'a', [second.id, foreign.id, first.id, 'unknown']);
		expect(found.map((tenant) => tenant.firstName)).toEqual(['Zwei', 'Eins']);
		expect(await findTenants(db, 'a', [])).toEqual([]);
	});
});
