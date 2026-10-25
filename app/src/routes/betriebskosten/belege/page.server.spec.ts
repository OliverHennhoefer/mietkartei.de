import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database } from '#lib/server/db/index.ts';
import { costItems, documents, leases } from '#lib/server/db/schema.ts';
import { createPolicy } from '#lib/server/insurance.ts';
import { MAX_ACCOUNT_DOCUMENT_BYTES } from '#lib/server/documents.ts';
import { documentErrorMessage } from '#lib/forms/documents.ts';
import {
	createCircle,
	getCostItem,
	listCategories,
	listKeys
} from '#lib/server/operating-costs.ts';
import {
	contextA,
	memoryStorage,
	outcome,
	routeEvent,
	seedCostItem,
	seedLease,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { actions as itemActions, load as loadItem } from './[id]/+page.server';
import { actions as newActions, load as loadNew } from './neu/+page.server';
import { load as loadList } from './+page.server';

// The list, the new and the edit page of the cost items (Belege) share their form and fixtures.

const storage = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('#lib/server/storage/index.ts', async (original) => ({
	...(await original<typeof import('#lib/server/storage/index.ts')>()),
	getStorage: async () => storage.current
}));

let db: Database;
let propertyId: string;
let unitId: string;
let categoryId: string;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2025-06-15T10:00:00Z'));
	storage.current = memoryStorage();
	db = await testDatabase();
	({ propertyId, unitId } = await seedUnit(db, 'a'));
	await seedCostItem(db, 'a', propertyId);
	categoryId = (await listCategories(db, 'a')).find((row) => row.allocationKeyId)!.id;
});

afterEach(() => {
	vi.useRealTimers();
});

const pdf = () => new File(['%PDF-1.4 Rechnung'], 'Rechnung.pdf', { type: 'application/pdf' });

function fields(overrides: Record<string, string | File> = {}) {
	return {
		propertyId,
		categoryId,
		allocationKeyId: '',
		billingCircleId: 'default',
		description: 'Hausreinigung',
		periodStart: '2025-01-01',
		periodEnd: '2025-12-31',
		amount: '480,00',
		allocable: 'on',
		...overrides
	};
}

function create(form: Record<string, string | File>) {
	return outcome(() => newActions.create(routeEvent(db, { form })));
}

/** The id from a redirect to an item's page. */
function itemIdOf(result: Awaited<ReturnType<typeof outcome>>): string {
	const match = 'redirect' in result && /^\/betriebskosten\/belege\/([\w-]+)/.exec(result.redirect);
	if (!match) throw new Error(`No item page: ${JSON.stringify(result)}`);
	return match[1];
}

describe('belege', () => {
	it('lists the current year by default, any year or all years on request', async () => {
		const list = (url: string) => outcome(() => loadList(routeEvent(db, { url })));
		expect(await list('/betriebskosten/belege')).toMatchObject({
			data: { year: 2025, items: [{ description: 'Grundsteuer' }], total: 60000 }
		});
		expect(await list('/betriebskosten/belege?year=2019')).toMatchObject({
			data: { year: 2019, items: [], years: expect.arrayContaining([2019, 2025]) }
		});
		expect(await list(`/betriebskosten/belege?year=&property=${propertyId}`)).toMatchObject({
			data: { year: null, property: { id: propertyId }, items: [expect.anything()] }
		});
		expect(await list('/betriebskosten/belege?property=fremd')).toMatchObject({
			data: { property: null }
		});
	});
});

describe('belege/neu', () => {
	it('prefills property and period from the query', async () => {
		const prefill = async (query: string) =>
			(
				(await outcome(() => loadNew(routeEvent(db, { url: `/x?${query}` })))) as {
					data: { prefill: unknown };
				}
			).data.prefill;
		expect(await prefill(`property=${propertyId}&year=2024`)).toEqual({
			propertyId,
			periodStart: '2024-01-01',
			periodEnd: '2024-12-31'
		});
		expect(await prefill('property=fremd&from=2025-02-01&to=2025-03-31')).toEqual({
			propertyId: undefined,
			periodStart: '2025-02-01',
			periodEnd: '2025-03-31'
		});
		expect(await prefill('year=letztes')).toEqual({ propertyId: undefined });
	});

	it('creates an item with its receipt and opens it', async () => {
		const id = itemIdOf(await create(fields({ receipt: pdf() })));
		const item = await getCostItem(db, 'a', id);
		expect(item).toMatchObject({ amount: 48000, receipts: [{ name: 'Rechnung.pdf' }] });
	});

	it('links the new item to the insurance policy it was entered for', async () => {
		const policy = await createPolicy(db, contextA, propertyId, {
			kind: 'building',
			insurer: 'Allianz',
			policyNumber: null,
			annualPremium: 120000,
			renewalDate: '2025-01-01',
			noticeMonths: 3,
			endDate: null,
			note: null
		});
		if (!policy.ok) throw new Error('setup failed');
		const id = itemIdOf(await create(fields({ insurancePolicyId: policy.id })));
		const [row] = await db.select().from(costItems).where(eq(costItems.id, id));
		expect(row.insurancePolicyId).toBe(policy.id);
	});

	it('goes on to the next item with the same property and period', async () => {
		expect(await create(fields({ next: '1' }))).toEqual({
			redirect: `/betriebskosten/belege/neu?property=${propertyId}&from=2025-01-01&to=2025-12-31`
		});
	});

	it('keeps the item when the receipt is refused and says so on its page', async () => {
		const empty = new File([''], 'leer.pdf', { type: 'application/pdf' });
		const huge = new File([new Uint8Array(11 * 1024 * 1024)], 'gross.pdf', {
			type: 'application/pdf'
		});
		expect(await create(fields({ receipt: huge }))).toMatchObject({ fail: 400 });
		// An empty file counts as no file.
		expect(await create(fields({ receipt: empty }))).toEqual({
			redirect: expect.stringMatching(/^\/betriebskosten\/belege\/[\w-]+$/)
		});
	});

	it('refuses ids of another account on their field', async () => {
		const other = await seedUnit(db, 'b');
		expect(await create(fields({ propertyId: other.propertyId }))).toMatchObject({
			fail: 400,
			data: { errors: { propertyId: 'Dieses Objekt gibt es nicht.' } }
		});
		expect(await create(fields({ categoryId: 'fremd' }))).toMatchObject({
			fail: 400,
			data: { errors: { categoryId: 'Diese Kostenart gibt es nicht.' } }
		});
		expect(await create(fields({ amount: '' }))).toMatchObject({ fail: 400 });
	});
});

describe('belege/[id]', () => {
	let itemId: string;

	beforeEach(async () => {
		itemId = itemIdOf(await create(fields()));
	});

	function act(
		action: keyof typeof itemActions,
		form: Record<string, string | File> = {},
		id = itemId
	) {
		return outcome(() => itemActions[action](routeEvent(db, { params: { id }, form })));
	}

	it('answers 404 for an item of another account', async () => {
		const other = await seedUnit(db, 'b');
		const foreign = await seedCostItem(db, 'b', other.propertyId);
		expect(
			await outcome(() => loadItem(routeEvent(db, { params: { id: foreign } })))
		).toMatchObject({ error: 404 });
		for (const action of ['update', 'amounts', 'upload', 'deleteReceipt', 'delete'] as const) {
			expect(await act(action, fields(), foreign), action).toMatchObject({ error: 404 });
		}
	});

	it('shows a refused receipt named in the query, nothing else', async () => {
		const page = (query: string) =>
			outcome(() => loadItem(routeEvent(db, { params: { id: itemId }, url: `/x?${query}` })));
		expect(await page('receiptError=too-large')).toMatchObject({
			data: { item: { id: itemId }, receiptError: expect.stringContaining('zu groß') }
		});
		expect(await page('receiptError=<script>')).toMatchObject({
			data: { receiptError: undefined }
		});
	});

	it('updates the item', async () => {
		expect(await act('update', fields({ amount: '500,00' }))).toEqual({
			redirect: `/betriebskosten/belege/${itemId}`
		});
		expect((await getCostItem(db, 'a', itemId))?.amount).toBe(50000);
		expect(await act('update', fields({ periodEnd: '2024-01-01' }))).toMatchObject({
			fail: 400,
			data: { form: 'item' }
		});
	});

	it('uploads and deletes receipts', async () => {
		expect(await act('upload', {})).toMatchObject({ fail: 400, data: { form: 'upload' } });
		expect(await act('upload', { receipt: pdf() })).toEqual({
			redirect: `/betriebskosten/belege/${itemId}`
		});
		const [receipt] = (await getCostItem(db, 'a', itemId))!.receipts;
		expect(await act('deleteReceipt', { documentId: 'fremd' })).toMatchObject({ error: 404 });
		expect(await act('deleteReceipt', { documentId: receipt.id })).toEqual({
			redirect: `/betriebskosten/belege/${itemId}`
		});
		expect(await db.select().from(documents)).toEqual([]);
	});

	it('refuses a receipt that is too large and keeps the item without it', async () => {
		const huge = new File([new Uint8Array(11 * 1024 * 1024)], 'gross.pdf', {
			type: 'application/pdf'
		});
		expect(await act('upload', { receipt: huge })).toMatchObject({
			fail: 400,
			data: { form: 'upload', errors: { receipt: expect.any(String) } }
		});
		expect((await getCostItem(db, 'a', itemId))!.receipts).toEqual([]);
	});

	it('refuses a receipt when the storage of the account is full', async () => {
		await db.insert(documents).values({
			id: 'voll',
			accountId: 'a',
			name: 'voll.pdf',
			mimeType: 'application/pdf',
			size: MAX_ACCOUNT_DOCUMENT_BYTES,
			storageKey: 'a/voll'
		});
		expect(await act('upload', { receipt: pdf() })).toEqual({
			fail: 400,
			data: { form: 'upload', errors: { receipt: documentErrorMessage('quota') } }
		});
		expect((await getCostItem(db, 'a', itemId))!.receipts).toEqual([]);
	});

	it('splits per unit only for an item with the direct key', async () => {
		expect(await act('amounts', { [`amount-${unitId}`]: '100,00' })).toMatchObject({
			fail: 400,
			data: { form: 'amounts', refused: expect.any(String) }
		});
		const direct = (await listKeys(db, 'a')).find((key) => key.kind === 'direct')!;
		const circle = await createCircle(db, contextA, propertyId, { name: 'EG', unitIds: [unitId] });
		if (!circle.ok) throw new Error(circle.reason);
		// The split goes over the units of the item's circle.
		await act('update', fields({ allocationKeyId: direct.id, billingCircleId: circle.id }));
		expect(await outcome(() => loadItem(routeEvent(db, { params: { id: itemId } })))).toMatchObject(
			{
				data: { units: [{ id: unitId }], unitAmounts: [] }
			}
		);
		expect(await act('amounts', { [`amount-${unitId}`]: 'viel' })).toMatchObject({
			fail: 400,
			data: { amountErrors: expect.anything() }
		});
		expect(await act('amounts', { [`amount-${unitId}`]: '480,00' })).toEqual({
			data: { form: 'amounts', saved: true }
		});
	});

	it('splits a direct key without a circle over all units of the property', async () => {
		const direct = (await listKeys(db, 'a')).find((key) => key.kind === 'direct')!;
		await act('update', fields({ allocationKeyId: direct.id, billingCircleId: '' }));
		expect(await outcome(() => loadItem(routeEvent(db, { params: { id: itemId } })))).toMatchObject(
			{ data: { units: [{ id: unitId }] } }
		);
	});

	it('asks for the amounts per lease of a unit that changed tenants', async () => {
		const direct = (await listKeys(db, 'a')).find((key) => key.kind === 'direct')!;
		await act('update', fields({ allocationKeyId: direct.id, billingCircleId: '' }));
		const load = () => outcome(() => loadItem(routeEvent(db, { params: { id: itemId } })));
		// One lease over the whole year: one amount for the unit.
		const whole = await seedLease(db, 'a', unitId, { startDate: '2024-01-01' });
		expect(await load()).toMatchObject({ data: { units: [{ id: unitId, leases: [] }] } });

		await db.delete(leases).where(eq(leases.id, whole));
		const before = await seedLease(db, 'a', unitId, {
			startDate: '2024-01-01',
			endDate: '2025-06-30'
		});
		const after = await seedLease(db, 'a', unitId, { startDate: '2025-08-01' });
		expect(await load()).toMatchObject({
			data: {
				units: [
					{
						id: unitId,
						leases: [
							{ id: before, start: '2025-01-01', end: '2025-06-30' },
							{ id: after, start: '2025-08-01', end: '2025-12-31' }
						]
					}
				]
			}
		});
		expect(
			await act('amounts', {
				[`amount-${unitId}-${before}`]: '300,00',
				[`amount-${unitId}-${after}`]: '150,00'
			})
		).toEqual({ data: { form: 'amounts', saved: true } });
		expect(await load()).toMatchObject({
			data: {
				unitAmounts: expect.arrayContaining([
					{ unitId, leaseId: before, amount: 30000 },
					{ unitId, leaseId: after, amount: 15000 }
				])
			}
		});
	});

	it('stores a receipt sent with the update and refuses an empty one', async () => {
		expect(await act('update', fields({ receipt: pdf() }))).toEqual({
			redirect: `/betriebskosten/belege/${itemId}`
		});
		expect((await getCostItem(db, 'a', itemId))!.receipts).toHaveLength(1);
		const empty = new File([], 'leer.pdf', { type: 'application/pdf' });
		expect(await act('upload', { receipt: empty })).toMatchObject({
			fail: 400,
			data: { form: 'upload', errors: { receipt: expect.any(String) } }
		});
	});

	it('refuses an update with a key of another account', async () => {
		expect(await act('update', fields({ allocationKeyId: 'fremd' }))).toMatchObject({
			fail: 400,
			data: { form: 'item' }
		});
	});

	it('deletes the item and returns to its year', async () => {
		expect(await act('delete')).toEqual({
			redirect: `/betriebskosten/belege?property=${propertyId}&year=2025`
		});
		expect(await getCostItem(db, 'a', itemId)).toBeUndefined();
	});
});
