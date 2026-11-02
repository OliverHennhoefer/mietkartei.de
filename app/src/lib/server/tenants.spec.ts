import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { auditLog } from './db/schema';
import { deleteTenant } from './deletion';
import type { LeaseSummary } from './leases';
import { createTenant, getTenant, listTenants, postalAddress, updateTenant } from './tenants';
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

describe('postalAddress', () => {
	const tenant = { id: 't1', street: null, postalCode: null, city: null };
	function lease(
		name: string,
		days: { startDate: string; endDate?: string | null },
		party: { joinedOn?: string | null; leftOn?: string | null } = {}
	): LeaseSummary {
		return {
			...days,
			endDate: days.endDate ?? null,
			unit: { name: 'Wohnung' },
			property: { name, street: `${name} 1e`, postalCode: '10115', city: 'Berlin' },
			parties: [
				{ tenant: { id: 't1' }, joinedOn: party.joinedOn ?? null, leftOn: party.leftOn ?? null }
			]
		} as unknown as LeaseSummary;
	}

	it('prefers the own address, then the lease the tenant is a party to today', () => {
		const running = lease('Lindenweg', { startDate: '2025-01-01' });
		expect(postalAddress({ ...tenant, street: 'Am Hang 2', city: 'Köln' }, [running])).toEqual({
			line: 'Am Hang 2, Köln',
			lease: null
		});
		expect(postalAddress(tenant, [running], '2026-03-01')).toEqual({
			line: 'Lindenweg 1e, 10115 Berlin',
			lease: 'Wohnung · Lindenweg'
		});
		expect(postalAddress(tenant, [], '2026-03-01')).toBeNull();
	});

	it('counts the days the tenant was a party, not those of a shared lease', () => {
		// Left the shared flat at the end of February, moves into the next one in April.
		const shared = lease('Lindenweg', { startDate: '2025-01-01' }, { leftOn: '2026-02-28' });
		const next = lease('Parkallee', { startDate: '2026-04-01' });
		expect(postalAddress(tenant, [shared, next], '2026-03-15')?.line).toBe(
			'Parkallee 1e, 10115 Berlin'
		);
		// Without a next lease, the last one they were a party to.
		const older = lease('Ahornweg', { startDate: '2020-01-01', endDate: '2024-12-31' });
		expect(postalAddress(tenant, [older, shared], '2026-03-15')?.line).toBe(
			'Lindenweg 1e, 10115 Berlin'
		);
		// Joins a running lease later: until then the old flat.
		const joining = lease('Birkenallee', { startDate: '2024-01-01' }, { joinedOn: '2026-05-01' });
		const current = lease('Lindenweg', { startDate: '2025-01-01', endDate: '2026-04-30' });
		expect(postalAddress(tenant, [joining, current], '2026-03-15')?.line).toBe(
			'Lindenweg 1e, 10115 Berlin'
		);
	});
});
