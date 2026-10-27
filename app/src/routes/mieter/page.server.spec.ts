import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { addDays, addMonths, today } from '#lib/dates.ts';
import { createPayment } from '#lib/server/ledger.ts';
import { getTenant } from '#lib/server/tenants.ts';
import {
	contextA,
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
import type { PageServerData } from './$types';

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

	it('groups the tenants by property, the ones without an active lease last', async () => {
		const lindenweg = await seedUnit(db, 'a', { propertyName: 'Lindenweg' });
		const otherLindenweg = await seedUnit(db, 'a', { propertyName: 'Lindenweg' });
		const ahornstrasse = await seedUnit(db, 'a', { propertyName: 'Ahornstraße' });
		const birkenallee = await seedUnit(db, 'a', { propertyName: 'Birkenallee' });
		const zedernweg = await seedUnit(db, 'a', { propertyName: 'Zedernweg' });
		const anna = await seedTenant(db, 'a', { firstName: 'Anna', lastName: 'Zeller' });
		const bernd = await seedTenant(db, 'a', { firstName: 'Bernd', lastName: 'Adler' });
		const carla = await seedTenant(db, 'a', { firstName: 'Carla', lastName: 'Berg' });
		const dora = await seedTenant(db, 'a', { firstName: 'Dora', lastName: 'Christ' });
		await seedLease(db, 'a', lindenweg.unitId, { tenantIds: [bernd] });
		await seedLease(db, 'a', otherLindenweg.unitId, { tenantIds: [dora] });
		await seedLease(db, 'a', ahornstrasse.unitId, { tenantIds: [anna] });
		// Renting in two properties, Carla goes with the first by name.
		await seedLease(db, 'a', zedernweg.unitId, { tenantIds: [carla] });
		await seedLease(db, 'a', birkenallee.unitId, { tenantIds: [carla] });
		const lindenwegRows = [
			[bernd, lindenweg.propertyId],
			[dora, otherLindenweg.propertyId]
		].sort((a, b) => a[1].localeCompare(b[1]));
		const result = (await run(load)) as { data: { tenants: { id: string; groupId: string }[] } };
		expect(result.data.tenants.map((row) => [row.id, row.groupId])).toEqual([
			[anna, ahornstrasse.propertyId],
			[carla, birkenallee.propertyId],
			...lindenwegRows,
			[tenantId, null]
		]);
	});

	it('puts the Rückstände and the coming moves above the list, with the figures of each tenant', async () => {
		const date = today();
		const { unitId } = await seedUnit(db, 'a');
		const second = await seedUnit(db, 'a');
		// The fixture tenant pays nothing since January 2025: in arrears.
		const owing = await seedLease(db, 'a', unitId, { tenantIds: [tenantId] });
		const leaving = await seedTenant(db, 'a', { firstName: 'Lea', lastName: 'Lang' });
		const coming = await seedTenant(db, 'a', { firstName: 'Kai', lastName: 'Kurz' });
		const moveOut = addMonths(date, 2);
		const leavingLease = await seedLease(db, 'a', second.unitId, {
			tenantIds: [leaving],
			startDate: date,
			endDate: moveOut,
			terminatedAt: date,
			terminatedBy: 'tenant'
		});
		const comingLease = await seedLease(db, 'a', second.unitId, {
			tenantIds: [coming],
			startDate: addDays(moveOut, 1)
		});
		// Lang paid today's rent, so only the fixture tenant owes.
		await createPayment(db, contextA, {
			leaseId: leavingLease,
			date,
			amount: 80000,
			source: 'manual'
		});

		const { data } = (await run(load)) as { data: PageServerData };
		const byId = new Map(data.tenants.map((row) => [row.id, row]));
		expect(byId.get(tenantId)).toMatchObject({
			activeLeases: [{ id: owing }],
			rent: 80000,
			since: '2025-01-01',
			openSince: '2025-01',
			moveOut: null,
			moveIn: null
		});
		expect(byId.get(tenantId)!.overdue).toBeGreaterThan(0);
		expect(byId.get(leaving)).toMatchObject({
			overdue: 0,
			moveOut: { date: moveOut, terminatedBy: 'tenant' }
		});
		expect(byId.get(coming)).toMatchObject({
			activeLeases: [],
			rent: 0,
			since: null,
			moveIn: { id: comingLease, date: addDays(moveOut, 1) }
		});
		expect(data.pending.map((item) => [item.kind, item.tenantId])).toEqual([
			['arrears', tenantId],
			['out', leaving],
			['in', coming]
		]);
		expect(data.overview).toMatchObject({ renting: 2, households: 2, rent: 160000 });
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
		expect(await run(tenantActions.archive, { params, form: {} })).toMatchObject({ error: 404 });
		expect(await run(tenantActions.restore, { params, form: {} })).toMatchObject({ error: 404 });
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
			data: { dossier: { leases: [{ id: leaseId, active: true }] } }
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

	it('archives a tenant whose leases ended and lists them apart until restored', async () => {
		const { unitId } = await seedUnit(db, 'a');
		await seedLease(db, 'a', unitId, { tenantIds: [tenantId], endDate: '2025-06-30' });
		const params = { id: tenantId };
		expect(await run(tenantActions.archive, { params, form: {} })).toEqual({
			redirect: '/mieter'
		});
		expect(await run(load)).toMatchObject({ data: { tenants: [], archived: [{ id: tenantId }] } });
		expect(await run(loadTenant, { params })).toMatchObject({
			data: { archiving: { archivedAt: expect.any(String) } }
		});
		expect(await run(tenantActions.restore, { params, form: {} })).toEqual({
			redirect: `/mieter/${tenantId}`
		});
		expect((await getTenant(db, 'a', tenantId))?.archivedAt).toBeNull();
	});

	it('refuses to archive a tenant with a running lease', async () => {
		const { unitId } = await seedUnit(db, 'a');
		await seedLease(db, 'a', unitId, { tenantIds: [tenantId] });
		expect(await run(tenantActions.archive, { params: { id: tenantId }, form: {} })).toMatchObject({
			fail: 400,
			data: { archiveError: expect.any(String) }
		});
	});
});
