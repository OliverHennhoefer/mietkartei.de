import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { getTenant } from '#lib/server/tenants.ts';
import {
	outcome,
	routeEvent,
	seedLease,
	seedTenant,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { actions as tenantActions, load as loadTenant } from './[id]/+page.server';
import { actions as editActions, load as loadEdit } from './[id]/bearbeiten/+page.server';
import { actions as newActions, load as loadNew } from './neu/+page.server';
import { load } from './+page.server';

let db: Database;
let tenantId: string;

beforeEach(async () => {
	db = await testDatabase();
	tenantId = await seedTenant(db, 'a');
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, options)));
}

const tenant = { firstName: 'Max', lastName: 'Müller', email: 'max@example.org' };

describe('mieter', () => {
	it('lists the tenants with their active leases', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const leaseId = await seedLease(db, 'a', unitId, { tenantIds: [tenantId] });
		await seedTenant(db, 'b');
		expect(await run(load)).toMatchObject({
			data: { tenants: [{ id: tenantId, activeLeases: [{ id: leaseId }] }] }
		});
	});

	it('creates a tenant and returns to a safe path with it preselected', async () => {
		expect(await run(loadNew, { url: '/mieter/neu?return=/vertraege/neu' })).toEqual({
			data: { returnTo: '/vertraege/neu' }
		});
		expect(await run(loadNew, { url: '/mieter/neu?return=https://evil.example' })).toMatchObject({
			data: { returnTo: null }
		});
		const back = await run(newActions.create, {
			form: { ...tenant, return: '/vertraege/neu?unitId=u1' }
		});
		expect(back).toEqual({
			redirect: expect.stringMatching(/^\/vertraege\/neu\?unitId=u1&tenantId=/)
		});
		expect(await run(newActions.create, { form: { ...tenant, return: '//evil.example' } })).toEqual(
			{
				redirect: expect.stringMatching(/^\/mieter\/[\w-]+$/)
			}
		);
		expect(await run(newActions.create, { form: { ...tenant, postalCode: '1' } })).toMatchObject({
			fail: 400
		});
	});

	it('answers 404 for a tenant of another account', async () => {
		const foreign = await seedTenant(db, 'b');
		const params = { id: foreign };
		expect(await run(loadTenant, { params })).toMatchObject({ error: 404 });
		expect(await run(loadEdit, { params })).toMatchObject({ error: 404 });
		expect(await run(editActions.update, { params, form: tenant })).toMatchObject({ error: 404 });
		expect(await run(tenantActions.delete, { params, form: {} })).toMatchObject({ error: 404 });
	});

	it('edits a tenant', async () => {
		const params = { id: tenantId };
		expect(await run(loadEdit, { params })).toMatchObject({ data: { tenant: { id: tenantId } } });
		expect(await run(editActions.update, { params, form: tenant })).toEqual({
			redirect: `/mieter/${tenantId}`
		});
		expect((await getTenant(db, 'a', tenantId))?.lastName).toBe('Müller');
		expect(await run(editActions.update, { params, form: { lastName: 'x' } })).toMatchObject({
			fail: 400
		});
	});

	it('deletes a tenant without a lease and keeps one with a lease', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const leaseId = await seedLease(db, 'a', unitId, { tenantIds: [tenantId] });
		expect(await run(loadTenant, { params: { id: tenantId } })).toMatchObject({
			data: { leases: [{ id: leaseId, active: true }] }
		});
		expect(await run(tenantActions.delete, { params: { id: tenantId }, form: {} })).toMatchObject({
			fail: 400,
			data: { deleteError: expect.any(String) }
		});
		const free = await seedTenant(db, 'a');
		expect(await run(tenantActions.delete, { params: { id: free }, form: {} })).toEqual({
			redirect: '/mieter'
		});
	});
});
