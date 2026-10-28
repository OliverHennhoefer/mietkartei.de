import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database } from '#lib/server/db/index.ts';
import { units } from '#lib/server/db/schema.ts';
import { getLease, listLeasePersons } from '#lib/server/leases.ts';
import { createPayment, listLedger } from '#lib/server/ledger.ts';
import {
	contextA,
	outcome,
	routeEvent,
	seedLease,
	seedTenant,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { load as loadLease } from './[id]/+layout.server';
import { actions as leaseActions, load as loadOverview } from './[id]/+page.server';
import { actions as editActions, load as loadEdit } from './[id]/bearbeiten/+page.server';
import { actions as newActions, load as loadNew } from './neu/+page.server';
import { load } from './+page.server';

// The lease list, the new lease form, the overview tab with persons and the end of the lease, and
// the edit form.

let db: Database;
let unitId: string;
let tenantId: string;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-03-02T10:00:00Z'));
	db = await testDatabase();
	({ unitId } = await seedUnit(db, 'a'));
	tenantId = await seedTenant(db, 'a');
});

afterEach(() => {
	vi.useRealTimers();
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, options)));
}

const lease = () => ({
	unitId,
	tenantIds: [tenantId],
	startDate: '2026-01-01',
	kind: 'residential',
	rentModel: 'fixed',
	operatingCostModel: 'prepayment',
	heatingCostModel: 'prepayment',
	baseRent: '650,00',
	operatingCostPrepayment: '150,00',
	securityDeposit: '1950,00'
});

/** The id from a redirect to a lease page. */
function idOf(result: Awaited<ReturnType<typeof outcome>>): string {
	if (!('redirect' in result)) throw new Error(JSON.stringify(result));
	return result.redirect.split('/').at(-1)!;
}

async function overview(id: string) {
	return run(loadOverview, { params: { id }, parent: { lease: await getLease(db, 'a', id) } });
}

describe('vertraege', () => {
	it('names what is missing before the first lease', async () => {
		expect(await run(load)).toMatchObject({
			data: { leases: [], prerequisites: { units: true, tenants: true } }
		});
		const empty = await testDatabase();
		expect(await outcome(() => load(routeEvent(empty)))).toMatchObject({
			data: { prerequisites: { units: false, tenants: false } }
		});
	});

	it('lists active leases before upcoming and ended ones', async () => {
		const ended = await seedLease(db, 'a', unitId, {
			startDate: '2024-01-01',
			endDate: '2025-06-30'
		});
		const upcoming = await seedLease(db, 'a', unitId, { startDate: '2026-06-01' });
		const active = await seedLease(db, 'a', unitId, {
			startDate: '2025-07-01',
			endDate: '2026-05-31'
		});
		expect(await run(load)).toMatchObject({
			data: {
				leases: [
					{ id: active, status: 'active', total: 80000 },
					{ id: upcoming, status: 'upcoming' },
					{ id: ended, status: 'ended' }
				]
			}
		});
	});

	it('names the parking space let with the flat', async () => {
		const [flat] = await db.select().from(units).where(eq(units.id, unitId));
		const [parking] = await db
			.insert(units)
			.values({
				accountId: 'a',
				propertyId: flat.propertyId,
				name: 'Stellplatz 3',
				kind: 'parking'
			})
			.returning({ id: units.id });
		const leaseId = await seedLease(db, 'a', unitId, { extraUnitIds: [parking.id] });
		expect(await run(load)).toMatchObject({
			data: { leases: [{ id: leaseId, extraUnits: ['Stellplatz 3'] }] }
		});
	});
});

describe('vertraege/neu', () => {
	it('preselects unit and tenant from the query', async () => {
		expect(await run(loadNew, { url: `/x?unitId=${unitId}&tenantId=${tenantId}` })).toMatchObject({
			data: { defaults: { unitId, tenantIds: tenantId }, units: [expect.anything()] }
		});
	});

	it('creates a lease and starts the ledger with the current month', async () => {
		const id = idOf(await run(newActions.create, { form: lease() }));
		expect(await getLease(db, 'a', id)).toMatchObject({
			startDate: '2026-01-01',
			ledgerStart: '2026-03-01'
		});
		// Only March is charged; the rent stands on the first of the month (due on the third working day).
		expect((await listLedger(db, 'a', id)).lines.map((line) => line.date)).toEqual(['2026-03-01']);
	});

	it('keeps the start of a lease that begins this month and books an opening balance', async () => {
		const id = idOf(
			await run(newActions.create, {
				form: { ...lease(), startDate: '2026-03-01', openingBalance: '-100,00' }
			})
		);
		expect(await getLease(db, 'a', id)).toMatchObject({ ledgerStart: null });
		expect((await listLedger(db, 'a', id)).lines).toContainEqual(
			expect.objectContaining({
				date: '2026-03-01',
				amount: -10000,
				label: expect.stringMatching(/Anfangssaldo$/)
			})
		);
	});

	it('refuses form errors with the whole form and the deposit hint', async () => {
		const result = await run(newActions.create, {
			form: { ...lease(), securityDeposit: '5000,00', startDate: '', openingBalance: 'viel' }
		});
		expect(result).toMatchObject({
			fail: 400,
			data: {
				errors: { startDate: expect.any(String), openingBalance: expect.any(String) },
				values: { tenantIds: tenantId, securityDeposit: '5000,00' },
				depositWarning: expect.stringContaining('551')
			}
		});
	});

	it('charges a lease that ended before this month from its start', async () => {
		const id = idOf(
			await run(newActions.create, {
				form: { ...lease(), startDate: '2025-11-01', endDate: '2026-01-31' }
			})
		);
		expect(await getLease(db, 'a', id)).toMatchObject({ ledgerStart: null });
		expect((await listLedger(db, 'a', id)).lines).toHaveLength(3);
	});

	it('keeps every tenant and gives no deposit hint without amounts or for a commercial lease', async () => {
		const second = await seedTenant(db, 'a', { lastName: 'Zweite' });
		const failed = (form: Record<string, string | string[]>) =>
			run(newActions.create, { form: { ...lease(), startDate: '', ...form } });
		expect(await failed({ tenantIds: [tenantId, second], baseRent: '' })).toMatchObject({
			fail: 400,
			data: { values: { tenantIds: `${tenantId},${second}` }, depositWarning: undefined }
		});
		expect(await failed({ kind: 'commercial', securityDeposit: '5000,00' })).toMatchObject({
			fail: 400,
			data: { depositWarning: undefined }
		});
	});

	it('refuses a unit or tenant of another account', async () => {
		const other = await seedUnit(db, 'b');
		expect(
			await run(newActions.create, { form: { ...lease(), unitId: other.unitId } })
		).toMatchObject({
			fail: 400,
			data: { errors: { unitId: 'Diese Einheit gibt es nicht.' } }
		});
		const foreignTenant = await seedTenant(db, 'b');
		expect(
			await run(newActions.create, { form: { ...lease(), tenantIds: [foreignTenant] } })
		).toMatchObject({ fail: 400, data: { errors: { tenantIds: expect.any(String) } } });
	});
});

describe('vertraege/[id]', () => {
	let id: string;

	beforeEach(async () => {
		id = await seedLease(db, 'a', unitId, { startDate: '2025-01-01', tenantIds: [tenantId] });
	});

	it('answers 404 for a lease of another account', async () => {
		const other = await seedUnit(db, 'b');
		const foreign = await seedLease(db, 'b', other.unitId);
		const params = { id: foreign };
		expect(await run(loadLease, { params })).toMatchObject({ error: 404 });
		expect(
			await run(leaseActions.addPersons, {
				params,
				form: { validFrom: '2026-01-01', persons: '3' }
			})
		).toMatchObject({ error: 404 });
		for (const action of [leaseActions.updatePersons, leaseActions.deletePersons]) {
			expect(
				await run(action, { params, form: { rowId: 'x', validFrom: '2026-01-01', persons: '3' } })
			).toMatchObject({ error: 404 });
		}
		expect(
			await run(leaseActions.end, {
				params,
				form: { terminatedAt: '2026-03-02', terminatedBy: 'tenant', endDate: '2026-05-31' }
			})
		).toMatchObject({ error: 404 });
		expect(await run(leaseActions.delete, { params, form: {} })).toMatchObject({ error: 404 });
		expect(await run(editActions.update, { params, form: lease() })).toMatchObject({ error: 404 });
	});

	it('sums up rent, balance and deposit and proposes the tenant’s notice period', async () => {
		expect(await run(loadLease, { params: { id } })).toMatchObject({
			data: { lease: { id }, leaseLabel: expect.any(String) }
		});
		expect(await overview(id)).toMatchObject({
			data: {
				currentRent: { total: 80000 },
				deposit: expect.anything(),
				endProposal: { terminatedAt: '2026-03-02', terminatedBy: 'tenant', endDate: '2026-05-31' },
				deadlines: null
			}
		});
	});

	it('records persons from a date, edits and deletes them, but not the first entry', async () => {
		const add = (form: Record<string, string>) =>
			run(leaseActions.addPersons, { params: { id }, form });
		expect(await add({ validFrom: '2026-01-01', persons: '3' })).toEqual({
			data: { which: 'persons' }
		});
		expect(await add({ validFrom: '2026-01-01', persons: '4' })).toMatchObject({
			fail: 400,
			data: { errors: { validFrom: 'Für dieses Datum gibt es schon einen Eintrag.' } }
		});
		expect(await add({ validFrom: '2024-01-01', persons: '4' })).toMatchObject({
			fail: 400,
			data: { errors: { validFrom: 'Das Datum liegt vor dem Vertragsbeginn.' } }
		});
		expect(await add({ persons: '99' })).toMatchObject({ fail: 400, data: { which: 'persons' } });

		const [first, later] = await listLeasePersons(db, 'a', id);
		const remove = (rowId: string) =>
			run(leaseActions.deletePersons, { params: { id }, form: { rowId } });
		expect(await remove(first.id)).toMatchObject({ fail: 400 });
		expect(await run(leaseActions.deletePersons, { params: { id }, form: {} })).toMatchObject({
			fail: 400
		});
		const update = (form: Record<string, string>) =>
			run(leaseActions.updatePersons, { params: { id }, form });
		expect(await update({ rowId: first.id, validFrom: '2025-01-01', persons: '2' })).toMatchObject({
			fail: 400
		});
		expect(await update({ rowId: later.id, validFrom: '2025-01-01', persons: '2' })).toMatchObject({
			fail: 400,
			data: { which: 'editPersons', errors: { validFrom: expect.any(String) } }
		});
		expect(await update({ rowId: later.id, validFrom: '2024-12-01', persons: '2' })).toMatchObject({
			fail: 400,
			data: { which: 'editPersons', errors: { validFrom: expect.any(String) } }
		});
		expect(await update({ rowId: later.id, persons: '99' })).toMatchObject({
			fail: 400,
			data: { which: 'editPersons' }
		});
		expect(
			await update({ rowId: 'gibt-es-nicht', validFrom: '2026-02-01', persons: '2' })
		).toMatchObject({ error: 404 });
		await add({ validFrom: '2026-06-01', persons: '4' });
		expect(await update({ rowId: later.id, validFrom: '2026-06-01', persons: '2' })).toMatchObject({
			fail: 400,
			data: { which: 'editPersons', errors: { validFrom: expect.any(String) } }
		});
		expect(await update({ rowId: later.id, validFrom: '2026-02-01', persons: '2' })).toEqual({
			redirect: `/vertraege/${id}`
		});
		expect((await listLeasePersons(db, 'a', id))[1]).toMatchObject({
			validFrom: '2026-02-01',
			persons: 2
		});
		expect(await remove(later.id)).toEqual({ redirect: `/vertraege/${id}` });
	});

	it('ends the lease with the notice period unless an earlier end was agreed', async () => {
		const end = (form: Record<string, string>) => run(leaseActions.end, { params: { id }, form });
		const notice = { terminatedAt: '2026-03-02', terminatedBy: 'tenant' };
		expect(await end({ ...notice, endDate: '2026-03-31' })).toMatchObject({
			fail: 400,
			data: { which: 'end', errors: { endDate: expect.stringContaining('§ 573c BGB') } }
		});
		expect(
			await end({
				terminatedAt: '2024-11-02',
				terminatedBy: 'tenant',
				endDate: '2024-12-31',
				earlyEndAgreed: 'on'
			})
		).toMatchObject({
			fail: 400,
			data: { errors: { endDate: 'Das Vertragsende liegt vor dem Vertragsbeginn.' } }
		});
		expect(await end({ terminatedBy: 'niemand' })).toMatchObject({ fail: 400 });
		expect(await end({ ...notice, endDate: '2026-03-31', earlyEndAgreed: 'on' })).toEqual({
			data: { which: 'end' }
		});
		expect(await getLease(db, 'a', id)).toMatchObject({ endDate: '2026-03-31' });
		expect(await overview(id)).toMatchObject({ data: { deadlines: expect.anything() } });
	});

	it('names § 580a BGB for the notice period of a commercial lease', async () => {
		const shop = await seedUnit(db, 'a', { name: 'Laden' });
		const commercial = await seedLease(db, 'a', shop.unitId, {
			startDate: '2025-01-01',
			kind: 'commercial'
		});
		expect(
			await run(leaseActions.end, {
				params: { id: commercial },
				form: { terminatedAt: '2026-03-02', terminatedBy: 'landlord', endDate: '2026-03-31' }
			})
		).toMatchObject({
			fail: 400,
			data: { errors: { endDate: expect.stringContaining('§ 580a Abs. 2 BGB') } }
		});
	});

	it('deletes a lease without bookings and keeps one with a payment', async () => {
		const paid = await seedLease(db, 'a', unitId, { startDate: '2025-01-01' });
		await createPayment(db, contextA, {
			leaseId: paid,
			date: '2026-01-05',
			amount: 80000,
			source: 'manual',
			note: null
		});
		expect(await overview(paid)).toMatchObject({
			data: { deletion: { blockers: [{ text: expect.stringContaining('1\u00a0Zahlung') }] } }
		});
		expect(await run(leaseActions.delete, { params: { id: paid }, form: {} })).toMatchObject({
			fail: 400,
			data: { deleteError: expect.any(String) }
		});
		expect(await run(leaseActions.delete, { params: { id }, form: {} })).toEqual({
			redirect: '/vertraege'
		});
		expect(await getLease(db, 'a', id)).toBeUndefined();
	});

	it('edits the lease and moves the ledger with it', async () => {
		const parent = { lease: await getLease(db, 'a', id) };
		const loaded = (await run(loadEdit, { params: { id }, parent })) as {
			data: { defaults: Record<string, string> };
		};
		expect(loaded.data.defaults).toMatchObject({ baseRent: '600,00', tenantIds: tenantId });
		const form = { ...loaded.data.defaults, tenantIds: [tenantId], baseRent: '620,00' };
		expect(await run(editActions.update, { params: { id }, form })).toEqual({
			redirect: `/vertraege/${id}`
		});
		expect((await getLease(db, 'a', id))?.baseRent).toBe(62000);
		expect(
			await run(editActions.update, { params: { id }, form: { ...form, baseRent: 'viel' } })
		).toMatchObject({ fail: 400, data: { errors: { baseRent: expect.any(String) } } });
		const foreignTenant = await seedTenant(db, 'b');
		expect(
			await run(editActions.update, {
				params: { id },
				form: { ...form, tenantIds: [foreignTenant] }
			})
		).toMatchObject({ fail: 400, data: { errors: { tenantIds: expect.any(String) } } });
		// A later persons entry pins the start.
		await run(leaseActions.addPersons, {
			params: { id },
			form: { validFrom: '2025-06-01', persons: '3' }
		});
		expect(
			await run(editActions.update, {
				params: { id },
				form: { ...form, startDate: '2025-07-01' }
			})
		).toMatchObject({
			fail: 400,
			data: { errors: { startDate: expect.stringContaining('01.06.2025') } }
		});
		// A form error keeps the kind as typed for the deposit hint, the lease's kind otherwise.
		expect(
			await run(editActions.update, {
				params: { id },
				form: { ...form, persons: 'viele', securityDeposit: '5000,00', kind: 'quatsch' }
			})
		).toMatchObject({ fail: 400, data: { depositWarning: expect.stringContaining('551') } });
		expect(
			await run(editActions.update, {
				params: { id },
				form: { ...form, persons: 'viele', baseRent: '' }
			})
		).toMatchObject({ fail: 400, data: { depositWarning: undefined } });
	});
});
