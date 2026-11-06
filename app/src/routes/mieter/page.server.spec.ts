import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { addDays, addMonths, today } from '#lib/dates.ts';
import { createPayment } from '#lib/server/ledger.ts';
import { createReminder } from '#lib/server/reminders.ts';
import { getTenant } from '#lib/server/tenants.ts';
import {
	contextA,
	outcome,
	ownerA,
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
		// Each lease begins today and its first rent is paid, so nobody needs attention.
		const paidLease = async (unitId: string, tenant: string) => {
			const leaseId = await seedLease(db, 'a', unitId, { tenantIds: [tenant], startDate: today() });
			await createPayment(db, contextA, {
				leaseId,
				date: today(),
				amount: 80000,
				source: 'manual'
			});
		};
		await paidLease(lindenweg.unitId, bernd);
		await paidLease(otherLindenweg.unitId, dora);
		await paidLease(ahornstrasse.unitId, anna);
		// Renting in two properties, Carla goes with the first by name.
		await paidLease(zedernweg.unitId, carla);
		await paidLease(birkenallee.unitId, carla);
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

	it('keeps the tenants of one property and lists the properties with tenants', async () => {
		const lindenweg = await seedUnit(db, 'a', { propertyName: 'Lindenweg' });
		const ahornstrasse = await seedUnit(db, 'a', { propertyName: 'Ahornstraße' });
		const anna = await seedTenant(db, 'a', { firstName: 'Anna', lastName: 'Zeller' });
		const bernd = await seedTenant(db, 'a', { firstName: 'Bernd', lastName: 'Adler' });
		const clara = await seedTenant(db, 'a', { firstName: 'Clara', lastName: 'Brandt' });
		await seedLease(db, 'a', lindenweg.unitId, { tenantIds: [anna], startDate: today() });
		await seedLease(db, 'a', ahornstrasse.unitId, { tenantIds: [bernd], startDate: today() });
		// Moving in later: she counts for the property already.
		const later = await seedUnit(db, 'a', { propertyName: 'Lindenweg' });
		await seedLease(db, 'a', later.unitId, {
			tenantIds: [clara],
			startDate: addMonths(today(), 2)
		});

		type Data = {
			tenants: { id: string }[];
			properties: { id: string; name: string }[];
			propertyId: string | null;
		};
		const all = ((await run(load)) as { data: Data }).data;
		expect(all.propertyId).toBeNull();
		expect(all.properties.map((property) => property.name)).toEqual([
			'Ahornstraße',
			'Lindenweg',
			'Lindenweg'
		]);
		expect(all.tenants.map((row) => row.id)).toContain(tenantId);

		const one = (
			(await run(load, { url: `/mieter?objekt=${lindenweg.propertyId}` })) as { data: Data }
		).data;
		expect(one.propertyId).toBe(lindenweg.propertyId);
		expect(one.tenants.map((row) => row.id)).toEqual([anna]);
		const coming = (
			(await run(load, { url: `/mieter?objekt=${later.propertyId}` })) as { data: Data }
		).data;
		expect(coming.tenants.map((row) => row.id)).toEqual([clara]);
		// A second coming lease elsewhere counts as well, not only the earliest move-in.
		const elsewhere = await seedUnit(db, 'a', { propertyName: 'Birkenallee' });
		await seedLease(db, 'a', elsewhere.unitId, {
			tenantIds: [clara],
			startDate: addMonths(today(), 4)
		});
		const second = (
			(await run(load, { url: `/mieter?objekt=${elsewhere.propertyId}` })) as { data: Data }
		).data;
		expect(second.tenants.map((row) => row.id)).toEqual([clara]);

		// An unknown property shows everyone.
		const unknown = ((await run(load, { url: '/mieter?objekt=nope' })) as { data: Data }).data;
		expect(unknown.propertyId).toBeNull();
		expect(unknown.tenants).toHaveLength(all.tenants.length);
	});

	it('puts the Rückstände and then the coming moves first, with the figures of each tenant', async () => {
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

		// Abel rents in a property that sorts first by name and pays, so nothing is due for her.
		const calm = await seedTenant(db, 'a', { firstName: 'Ada', lastName: 'Abel' });
		const third = await seedUnit(db, 'a', { propertyName: 'Ahornweg' });
		const calmLease = await seedLease(db, 'a', third.unitId, {
			tenantIds: [calm],
			startDate: date
		});
		await createPayment(db, contextA, {
			leaseId: calmLease,
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
			moveOut: { date: moveOut, terminatedBy: 'tenant', label: expect.any(String) }
		});
		expect(byId.get(coming)).toMatchObject({
			activeLeases: [],
			rent: 0,
			since: null,
			moveIn: { id: comingLease, date: addDays(moveOut, 1) }
		});
		expect(data.tenants.map((row) => [row.id, row.groupId])).toEqual([
			[tenantId, 'attention'],
			[leaving, 'attention'],
			[coming, 'attention'],
			[calm, third.propertyId]
		]);
	});

	it('lists every letter about the Rückstand oldest first, the latest as the reminder', async () => {
		const { unitId } = await seedUnit(db, 'a');
		// The fixture tenant pays nothing since January 2025; the letters are written out of order, the
		// last two on the same day.
		const leaseId = await seedLease(db, 'a', unitId, { tenantIds: [tenantId] });
		for (const [level, date] of [
			[3, '2025-05-12'],
			[1, '2025-03-10'],
			[2, '2025-05-12']
		] as const) {
			const result = await createReminder(db, contextA, leaseId, {
				level,
				date,
				paymentDeadline: addDays(date, 14)
			});
			expect(result?.ok).toBe(true);
		}

		const { data } = (await run(load)) as { data: PageServerData };
		const row = data.tenants.find((tenant) => tenant.id === tenantId)!;
		expect(row.reminders).toEqual([
			{ level: 1, date: '2025-03-10' },
			{ level: 2, date: '2025-05-12' },
			{ level: 3, date: '2025-05-12' }
		]);
		expect(row.reminder).toEqual({ level: 3, date: '2025-05-12' });
	});

	it('creates a tenant and goes on to the lease form with it preselected', async () => {
		const result = await run(newActions.create, { form: tenant });
		expect(result).toEqual({
			redirect: expect.stringMatching(/^\/vertraege\/neu\?tenantId=[\w-]+&created=1$/)
		});
	});

	it('saves a tenant and starts the next one, naming the tenant just saved', async () => {
		const result = await run(newActions.create, { form: { ...tenant, next: '1' } });
		expect(result).toEqual({ redirect: expect.stringMatching(/^\/mieter\/neu\?angelegt=[\w-]+$/) });
		const url = (result as { redirect: string }).redirect;
		expect(await run(loadNew, { url })).toMatchObject({
			data: { returnTo: null, created: { firstName: 'Max', lastName: 'Müller' } }
		});
		// Another account's tenant names nothing.
		const otherAccount = { ...ownerA, id: 'user-b', accountId: 'b' };
		expect(await run(loadNew, { url, user: otherAccount })).toMatchObject({
			data: { created: null }
		});
	});

	it('keeps the birth date of a tenant through create and edit', async () => {
		const result = await run(newActions.create, { form: { ...tenant, birthDate: '1980-03-14' } });
		const id = new URL(
			(result as { redirect: string }).redirect,
			'http://localhost'
		).searchParams.get('tenantId')!;
		expect(await getTenant(db, 'a', id)).toMatchObject({ birthDate: '1980-03-14' });
		await run(editActions.update, { params: { id }, form: { ...tenant, birthDate: '1980-03-15' } });
		expect(await getTenant(db, 'a', id)).toMatchObject({ birthDate: '1980-03-15' });
		await run(editActions.update, { params: { id }, form: tenant });
		expect(await getTenant(db, 'a', id)).toMatchObject({ birthDate: null });
	});

	it('creates a tenant and returns to a safe path with it preselected', async () => {
		expect(await run(loadNew, { url: '/mieter/neu?return=/vertraege/neu' })).toEqual({
			data: { returnTo: '/vertraege/neu', created: null }
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
				redirect: expect.stringMatching(/^\/vertraege\/neu\?tenantId=[\w-]+&created=1$/)
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

	it('keeps the address empty for a tenant in the rented unit and needs all of a different one', async () => {
		const inUnit = { ...tenant, addressChoice: '1', street: 'Alte Straße 1', city: 'Köln' };
		const redirect = (await run(newActions.create, { form: inUnit })) as { redirect: string };
		const id = /tenantId=([\w-]+)/.exec(redirect.redirect)![1];
		expect(await getTenant(db, 'a', id)).toMatchObject({
			street: null,
			postalCode: null,
			city: null
		});

		const partial = { ...tenant, addressChoice: '1', separateAddress: 'on', street: 'Am Hang 2' };
		expect(await run(newActions.create, { form: partial })).toMatchObject({
			fail: 400,
			data: { errors: { postalCode: expect.any(String), city: expect.any(String) } }
		});
	});

	it('shows the address of the rented unit for a tenant without one', async () => {
		const params = { id: tenantId };
		expect(await run(loadTenant, { params })).toMatchObject({ data: { address: null } });
		expect(await run(loadEdit, { params })).toMatchObject({ data: { leaseAddress: null } });
		const { unitId } = await seedUnit(db, 'a', { name: 'Wohnung 2' });
		await seedLease(db, 'a', unitId, { tenantIds: [tenantId] });
		expect(await run(loadTenant, { params })).toMatchObject({
			data: { address: { line: 'Lindenstraße 4, 10115 Berlin', lease: 'Wohnung 2 · Haus' } }
		});
		expect(await run(loadEdit, { params })).toMatchObject({
			data: { leaseAddress: 'Lindenstraße 4, 10115 Berlin' }
		});
		const elsewhere = await seedTenant(db, 'a', {
			street: 'Am Hang 2',
			postalCode: '50667',
			city: 'Köln'
		});
		await seedLease(db, 'a', (await seedUnit(db, 'a')).unitId, { tenantIds: [elsewhere] });
		expect(await run(loadTenant, { params: { id: elsewhere } })).toMatchObject({
			data: { address: { line: 'Am Hang 2, 50667 Köln', lease: null } }
		});
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
