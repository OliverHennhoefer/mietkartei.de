import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { consumerPriceIndex } from '#lib/server/db/schema.ts';
import { getLease } from '#lib/server/leases.ts';
import { listRentChanges } from '#lib/server/rents.ts';
import {
	outcome,
	routeEvent,
	seedLease,
	seedTenant,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { GET as letter } from './brief/[changeId]/+server';
import { GET as letterText, PUT as saveLetterText } from './brief/[changeId]/text/+server';
import { actions, load } from './+page.server';

let db: Database;
let leaseId: string;

/** A lease of account `a` with the given overrides; returns its id. */
async function lease(overrides: Parameters<typeof seedLease>[3] = {}) {
	const { unitId } = await seedUnit(db, 'a');
	const tenantId = await seedTenant(db, 'a', {
		salutation: 'Frau',
		street: 'Lindenstraße 4',
		postalCode: '10115',
		city: 'Berlin'
	});
	return seedLease(db, 'a', unitId, { tenantIds: [tenantId], ...overrides });
}

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
	db = await testDatabase();
	// An indexed residential lease from 2024-01-01 at 600 € + 150 € + 50 €, base January 2024.
	leaseId = await lease({
		startDate: '2024-01-01',
		rentModel: 'indexed',
		indexBaseMonth: '2024-01',
		indexBaseValue: 118.2
	});
});

afterEach(() => {
	vi.useRealTimers();
});

async function page(id = leaseId, query = '') {
	const parent = { lease: await getLease(db, 'a', id) };
	return outcome(() =>
		load(routeEvent(db, { params: { id }, url: `/vertraege/${id}/miethoehe${query}`, parent }))
	);
}

function act(action: keyof typeof actions, form: Record<string, string> = {}, id = leaseId) {
	return outcome(() => actions[action](routeEvent(db, { params: { id }, form })));
}

const change = {
	validFrom: '2026-12-01',
	baseRent: '600,00',
	operatingCostPrepayment: '180,00',
	heatingCostPrepayment: '50,00',
	reason: 'statement'
};

describe('miethoehe', () => {
	it('prefills a change from next month with the rent valid then', async () => {
		expect(await page()).toMatchObject({
			data: {
				changeFrom: '2026-11-01',
				changeDefaults: { baseRent: 60000, operatingCostPrepayment: 15000 },
				prepayment: null,
				nextStepAllowed: undefined,
				landlordComplete: false
			}
		});
	});

	it('takes the suggested prepayments of a statement, ignoring malformed ones', async () => {
		expect(await page(leaseId, '?prepayment=18000&heating=abc')).toMatchObject({
			data: {
				prepayment: 18000,
				heatingPrepayment: null,
				changeDefaults: { operatingCostPrepayment: 18000, heatingCostPrepayment: 5000 }
			}
		});
	});

	it('answers 404 for every action on a lease of another account', async () => {
		const { unitId } = await seedUnit(db, 'b');
		const foreign = await seedLease(db, 'b', unitId);
		for (const action of [
			'change',
			'step',
			'propose',
			'approve',
			'delivery',
			'demand',
			'consent',
			'delete'
		] as const) {
			expect(await act(action, change, foreign), action).toMatchObject({ error: 404 });
		}
		expect(
			await outcome(() => letter(routeEvent(db, { params: { id: foreign, changeId: 'x' } })))
		).toMatchObject({ error: 404 });
	});

	it('records a manual change and deletes it again', async () => {
		expect(await act('change', change)).toEqual({ data: { source: 'change', saved: true } });
		expect(await act('change', change)).toMatchObject({
			fail: 400,
			data: { source: 'change', refusal: expect.any(String), values: { baseRent: '600,00' } }
		});
		expect(await act('change', { ...change, validFrom: '' })).toMatchObject({
			fail: 400,
			data: { source: 'change', errors: { validFrom: expect.any(String) } }
		});
		const added = (await listRentChanges(db, 'a', leaseId)).find(
			(row) => row.validFrom === '2026-12-01'
		)!;
		expect(await act('delete', { changeId: '' })).toMatchObject({ error: 404 });
		expect(await act('delete', { changeId: 'unbekannt' })).toMatchObject({ error: 404 });
		expect(await act('delete', { changeId: added.id })).toEqual({
			redirect: `/vertraege/${leaseId}/miethoehe`
		});
		const [initial] = await listRentChanges(db, 'a', leaseId);
		expect(await act('delete', { changeId: initial.id })).toMatchObject({
			fail: 400,
			data: { source: 'delete' }
		});
	});

	it('asks for a reason when the base rent of an indexed lease changes', async () => {
		expect(await act('change', { ...change, baseRent: '700,00' })).toMatchObject({
			fail: 400,
			data: { errors: { note: expect.any(String) } }
		});
	});

	it('proposes an index change, approves it and prints the letter', async () => {
		expect(await act('propose')).toMatchObject({ fail: 400, data: { source: 'propose' } });
		await db
			.insert(consumerPriceIndex)
			.values({ month: '2026-01', value: 124.3, baseYear: '2020' });
		expect(await act('propose')).toEqual({ data: { source: 'propose', saved: true } });
		const proposal = (await listRentChanges(db, 'a', leaseId)).find(
			(row) => row.status === 'proposed'
		)!;
		expect(await page()).toMatchObject({ data: { situation: expect.anything() } });

		expect(await act('approve', { changeId: proposal.id, deliveredOn: '' })).toMatchObject({
			fail: 400,
			data: { source: 'approve', errors: expect.anything() }
		});
		expect(await act('approve', { changeId: proposal.id, deliveredOn: '2026-10-15' })).toEqual({
			data: { source: 'approve', saved: true }
		});
		expect(
			await act('approve', { changeId: proposal.id, deliveredOn: '2026-10-15' })
		).toMatchObject({ fail: 400, data: { source: 'approve', refusal: expect.any(String) } });
		expect(
			await act('approve', { changeId: 'unbekannt', deliveredOn: '2026-10-15' })
		).toMatchObject({ error: 404 });

		// The letter arrived later than entered: the change moves with it.
		expect(await act('delivery', { changeId: proposal.id, deliveredOn: '' })).toMatchObject({
			fail: 400,
			data: { source: 'delivery', errors: { deliveredOn: expect.any(String) } }
		});
		expect(await act('delivery', { changeId: proposal.id, deliveredOn: '2026-11-02' })).toEqual({
			redirect: `/vertraege/${leaseId}/miethoehe`
		});
		const corrected = (await listRentChanges(db, 'a', leaseId)).find(
			(row) => row.id === proposal.id
		)!;
		expect(corrected).toMatchObject({ validFrom: '2027-01-01', deliveredOn: '2026-11-02' });
		const [initial] = await listRentChanges(db, 'a', leaseId);
		expect(
			await act('delivery', { changeId: initial.id, deliveredOn: '2026-11-02' })
		).toMatchObject({ fail: 400, data: { source: 'delivery', refusal: expect.any(String) } });

		const printed = (await outcome(() =>
			letter(routeEvent(db, { params: { id: leaseId, changeId: proposal.id } }))
		)) as { data: Response };
		expect(printed.data.headers.get('Content-Type')).toBe('application/pdf');

		// The letter's text, as laid out on the sheet, and edited there.
		const params = { id: leaseId, changeId: proposal.id };
		const shown = (await outcome(() => letterText(routeEvent(db, { params })))) as {
			data: Response;
		};
		const { blocks } = (await shown.data.json()) as { blocks: { paragraph?: string }[] };
		const paragraphs = blocks.flatMap((block) => block.paragraph ?? []);
		const save = (json: unknown, changeId = proposal.id) =>
			outcome(() => saveLetterText(routeEvent(db, { params: { ...params, changeId }, json })));
		expect(await save({ paragraphs: [...paragraphs, 'Mit freundlichem Gruß'] })).toMatchObject({
			data: { status: 204 }
		});
		expect(await save({ paragraphs: [''] })).toMatchObject({ error: 400 });
		expect(await save({ paragraphs }, 'x')).toMatchObject({ error: 404 });
		expect(
			await outcome(() => letterText(routeEvent(db, { params: { ...params, changeId: 'x' } })))
		).toMatchObject({ error: 404 });
		const foreignSite = routeEvent(db, { params, json: { paragraphs } }) as { request: Request };
		foreignSite.request.headers.set('origin', 'https://example.org');
		expect(await outcome(() => saveLetterText(foreignSite as never))).toMatchObject({
			error: 403
		});
		expect(
			await outcome(() => letter(routeEvent(db, { params: { id: leaseId, changeId: 'x' } })))
		).toMatchObject({ error: 404 });
	});

	it('adds Staffel steps only to a graduated lease', async () => {
		const step = { validFrom: '2027-01-01', baseRent: '650,00' };
		expect(await act('step', step)).toMatchObject({
			fail: 400,
			data: { source: 'step', refusal: expect.any(String) }
		});
		const graduated = await lease({ rentModel: 'graduated' });
		expect(await page(graduated)).toMatchObject({ data: { nextStepAllowed: expect.any(String) } });
		expect(await act('step', { ...step, baseRent: '' }, graduated)).toMatchObject({
			fail: 400,
			data: { source: 'step', errors: expect.anything() }
		});
		expect(await act('step', step, graduated)).toEqual({ data: { source: 'step', saved: true } });
	});

	it('demands a § 558 increase, records the consent and prints the letter', async () => {
		// A fixed lease from 2024-01-01 at 600 € on 64 m²; today is 01.10.2026.
		const fixed = await lease({ startDate: '2024-01-01' });
		expect(await page(fixed)).toMatchObject({
			data: {
				comparative: {
					lastChange: '2024-01-01',
					demandFrom: '2025-01-01',
					validFrom: '2027-01-01',
					currentBaseRent: 60000,
					caps: { 20: 72000, 15: 69000 },
					refusal: undefined
				}
			}
		});
		const demand = {
			deliveredOn: '2026-10-05',
			baseRent: '720,00',
			comparativeRent: '11,50',
			cappingPercent: '20',
			comparisonSource: 'comparable_flats',
			comparisonDetails: 'Lindenstraße 6, 2. OG, 66 m², 11,60 € je m²; …'
		};
		expect(await act('demand', { ...demand, cappingPercent: '30' }, fixed)).toMatchObject({
			fail: 400,
			data: { source: 'demand', errors: { cappingPercent: expect.any(String) } }
		});
		expect(await act('demand', { ...demand, baseRent: '800,00' }, fixed)).toMatchObject({
			fail: 400,
			data: { source: 'demand', refusal: expect.stringContaining('Kappungsgrenze') }
		});
		expect(await act('demand', demand, fixed)).toEqual({
			data: { source: 'demand', saved: true }
		});
		const [, demanded] = await listRentChanges(db, 'a', fixed);
		expect(demanded).toMatchObject({ status: 'proposed', validFrom: '2027-01-01' });
		const printed = (await outcome(() =>
			letter(routeEvent(db, { params: { id: fixed, changeId: demanded.id } }))
		)) as { data: Response };
		expect(printed.data.headers.get('Content-Type')).toBe('application/pdf');

		const consent = { changeId: demanded.id, consentedOn: '2026-11-02', baseRent: '720,00' };
		expect(await act('consent', { ...consent, baseRent: '' }, fixed)).toMatchObject({
			fail: 400,
			data: { source: 'consent', errors: { baseRent: expect.any(String) } }
		});
		expect(await act('consent', { ...consent, baseRent: '900,00' }, fixed)).toMatchObject({
			fail: 400,
			data: { source: 'consent', refusal: expect.any(String) }
		});
		expect(await act('consent', { ...consent, changeId: 'x' }, fixed)).toMatchObject({
			error: 404
		});
		expect(await act('consent', consent, fixed)).toEqual({
			data: { source: 'consent', saved: true }
		});
		const [, agreed] = await listRentChanges(db, 'a', fixed);
		expect(agreed).toMatchObject({ status: 'approved', baseRent: 72000 });
	});
});
