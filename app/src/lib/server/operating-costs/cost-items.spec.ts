import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db';
import { auditLog, costItemUnitAmounts, costItems, documents, units } from '../db/schema';
import { getDocument, storeDocument } from '../documents';
import { deleteProperty } from '../deletion';
import { QUOTAS } from '../quotas';
import { openFileStorage } from '../storage/fs';
import type { Storage } from '../storage';
import { createPolicy, linkCostItemToPolicy } from '../insurance';
import { contextA, contextB, integrityProblems, seedUnit, testDatabase } from '../testing';
import { createCircle } from './circles';
import {
	costItemHistory,
	createCostItem,
	deleteCostItem,
	getCostItem,
	listCostItemYears,
	listCostItems,
	listUnitAmounts,
	replaceUnitAmounts,
	updateCostItem,
	type CostItemInput
} from './cost-items';
import { ensureDefaults } from './defaults';
import { createKey, listKeys } from './keys';
import { listCategories } from './categories';

let db: Database;
let root: string;
let storage: Storage;

/** The seeded categories and keys of account `a`, by name. */
let categoryId: Record<string, string>;
let keyId: Record<string, string>;
let propertyId: string;
let unitId: string;

beforeEach(async () => {
	db = await testDatabase();
	root = await mkdtemp(join(tmpdir(), 'mietkartei-cost-items-'));
	storage = openFileStorage(root);
	await ensureDefaults(db, 'a');
	categoryId = Object.fromEntries((await listCategories(db, 'a')).map((row) => [row.name, row.id]));
	keyId = Object.fromEntries((await listKeys(db, 'a')).map((row) => [row.name, row.id]));
	({ propertyId, unitId } = await seedUnit(db, 'a', { name: 'EG' }));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function input(overrides: Partial<CostItemInput> = {}): CostItemInput {
	return {
		propertyId,
		categoryId: categoryId.Grundsteuer,
		allocationKeyId: keyId.Wohnfläche,
		billingCircleId: null,
		description: 'Grundsteuer 2025',
		supplier: 'Stadt Berlin',
		invoiceDate: '2025-02-10',
		periodStart: '2025-01-01',
		periodEnd: '2025-12-31',
		amount: 120000,
		allocable: true,
		fuel: null,
		fuelKwh: null,
		co2Kg: null,
		co2Cost: null,
		...overrides
	};
}

async function create(context: typeof contextA, overrides: Partial<CostItemInput> = {}) {
	const result = await createCostItem(db, context, input(overrides));
	if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
	return result.id;
}

describe('cost items', () => {
	it('refuses an item above the account limit with 409', async () => {
		await create(contextA);
		const limit = QUOTAS.costItems.max;
		QUOTAS.costItems.max = 1;
		try {
			const refusal = await createCostItem(db, contextA, input()).catch((e) => e);
			expect(isHttpError(refusal, 409)).toBe(true);
			expect(refusal.body.message).toContain('höchstens 1 Belege');
		} finally {
			QUOTAS.costItems.max = limit;
		}
		expect(await db.select().from(costItems)).toHaveLength(1);
	});

	it('creates an item with the names of its category, key and circle, and logs the amount', async () => {
		const circle = await createCircle(db, contextA, propertyId, {
			name: 'Haus',
			unitIds: [unitId]
		});
		if (!circle.ok) throw new Error('setup failed');
		const id = await create(contextA, {
			billingCircleId: circle.id,
			categoryId: categoryId.Heizung,
			allocationKeyId: keyId['Heizung 70/30'],
			description: 'Gas 2025',
			amount: 300000,
			fuel: 'gas',
			fuelKwh: 25000,
			co2Kg: 5025,
			co2Cost: 30000
		});
		expect(await getCostItem(db, 'a', id)).toMatchObject({
			accountId: 'a',
			propertyName: 'Haus',
			categoryName: 'Heizung',
			categoryBetrkvItem: 4,
			keyName: 'Heizung 70/30',
			keyKind: 'mixed',
			circleName: 'Haus',
			description: 'Gas 2025',
			supplier: 'Stadt Berlin',
			invoiceDate: '2025-02-10',
			amount: 300000,
			allocable: true,
			fuel: 'gas',
			fuelKwh: 25000,
			co2Kg: 5025,
			co2Cost: 30000,
			receipts: []
		});
		const audit = await db.select().from(auditLog).where(eq(auditLog.entity, 'cost_item'));
		expect(audit.map((entry) => entry.summary)).toEqual([
			'Beleg Gas 2025 (3.000,00\u00a0€) angelegt'
		]);
	});

	it('refuses references outside the account or the property', async () => {
		const other = await seedUnit(db, 'a', { propertyName: 'Anderes Haus' });
		const otherKey = await createKey(db, contextA, {
			name: 'Nur dort',
			kind: 'units',
			propertyId: other.propertyId,
			meterKind: null,
			consumptionPercent: null
		});
		const otherCircle = await createCircle(db, contextA, other.propertyId, {
			name: 'Dort',
			unitIds: [other.unitId]
		});
		if (!otherKey.ok || !otherCircle.ok) throw new Error('setup failed');

		expect(await createCostItem(db, contextA, input({ propertyId: 'nope' }))).toEqual({
			ok: false,
			reason: 'unknown-property'
		});
		expect(await createCostItem(db, contextA, input({ categoryId: 'nope' }))).toEqual({
			ok: false,
			reason: 'unknown-category'
		});
		expect(await createCostItem(db, contextA, input({ allocationKeyId: otherKey.id }))).toEqual({
			ok: false,
			reason: 'unknown-key'
		});
		expect(await createCostItem(db, contextA, input({ billingCircleId: otherCircle.id }))).toEqual({
			ok: false,
			reason: 'unknown-circle'
		});
		// The property's own key works.
		expect(
			(
				await createCostItem(
					db,
					contextA,
					input({ propertyId: other.propertyId, allocationKeyId: otherKey.id })
				)
			).ok
		).toBe(true);
	});

	it('lists by property and by the years a period overlaps, newest invoice first', async () => {
		const other = await seedUnit(db, 'a', { propertyName: 'Anderes Haus' });
		const grundsteuer = await create(contextA);
		const heizung = await create(contextA, {
			description: 'Heizperiode',
			invoiceDate: '2026-08-01',
			periodStart: '2025-07-01',
			periodEnd: '2026-06-30'
		});
		const elsewhere = await create(contextA, {
			propertyId: other.propertyId,
			invoiceDate: '2025-03-01'
		});
		const undated = await create(contextA, {
			description: 'Ohne Datum',
			invoiceDate: null,
			periodStart: '2024-01-01',
			periodEnd: '2024-12-31'
		});

		const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
		expect(ids(await listCostItems(db, 'a'))).toEqual([heizung, elsewhere, grundsteuer, undated]);
		expect(ids(await listCostItems(db, 'a', { propertyId }))).toEqual([
			heizung,
			grundsteuer,
			undated
		]);
		expect(ids(await listCostItems(db, 'a', { propertyId, year: 2025 }))).toEqual([
			heizung,
			grundsteuer
		]);
		expect(ids(await listCostItems(db, 'a', { year: 2026 }))).toEqual([heizung]);
		expect(ids(await listCostItems(db, 'a', { year: 2024 }))).toEqual([undated]);
		expect(await listCostItemYears(db, 'a')).toEqual([2026, 2025, 2024]);
	});

	it('remembers the texts and the last item per property and category for the next one', async () => {
		await create(contextA);
		await create(contextA, {
			description: 'Grundsteuer 2026',
			periodStart: '2026-01-01',
			periodEnd: '2026-12-31',
			amount: 125000
		});
		await create(contextA, {
			categoryId: categoryId['Straßenreinigung und Müllbeseitigung'],
			description: 'Müllabfuhr',
			supplier: 'BSR'
		});
		const history = await costItemHistory(db, 'a');
		expect(history.descriptions).toEqual(['Grundsteuer 2026', 'Müllabfuhr', 'Grundsteuer 2025']);
		expect(history.suppliers).toEqual(['Stadt Berlin', 'BSR']);
		expect(history.last).toHaveLength(2);
		expect(history.last.find((row) => row.categoryId === categoryId.Grundsteuer)).toMatchObject({
			description: 'Grundsteuer 2026',
			amount: 125000,
			periodEnd: '2026-12-31'
		});
		expect(await costItemHistory(db, 'b')).toEqual({ descriptions: [], suppliers: [], last: [] });
	});

	it('offers every year a period overlaps, also the years in between', async () => {
		const long = await create(contextA, {
			description: 'Wartungsvertrag',
			periodStart: '2020-07-01',
			periodEnd: '2023-06-30'
		});
		expect(await listCostItemYears(db, 'a')).toEqual([2023, 2022, 2021, 2020]);
		expect((await listCostItems(db, 'a', { year: 2022 })).map((row) => row.id)).toEqual([long]);
	});

	it('updates every field and drops per-unit amounts when the key is no longer direct', async () => {
		const id = await create(contextA, { allocationKeyId: keyId['Beträge je Einheit'] });
		expect(await replaceUnitAmounts(db, contextA, id, [{ unitId, amount: 50000 }])).toBe('updated');
		expect(await listUnitAmounts(db, 'a', id)).toEqual([{ unitId, amount: 50000 }]);

		const changed = input({
			allocationKeyId: keyId['Beträge je Einheit'],
			description: 'Grundsteuer 2025 (korrigiert)',
			supplier: null,
			invoiceDate: null,
			amount: 125000,
			allocable: false
		});
		expect(await updateCostItem(db, contextA, id, changed)).toEqual({ ok: true });
		expect(await getCostItem(db, 'a', id)).toMatchObject(changed);
		expect(await listUnitAmounts(db, 'a', id)).toHaveLength(1);

		expect(
			await updateCostItem(db, contextA, id, input({ allocationKeyId: keyId.Wohnfläche }))
		).toEqual({
			ok: true
		});
		expect(await listUnitAmounts(db, 'a', id)).toEqual([]);
	});

	it('replaces the per-unit amounts in one batch, only for units of the property', async () => {
		const [og] = await db
			.insert(units)
			.values({ accountId: 'a', propertyId, name: 'OG', kind: 'apartment' })
			.returning({ id: units.id });
		const elsewhere = await seedUnit(db, 'a', { propertyName: 'Anderes Haus' });
		const id = await create(contextA, {
			allocationKeyId: keyId['Beträge je Einheit'],
			amount: 90000
		});

		// 400 € + 350 € of 900 €, listed by unit name: EG before OG.
		expect(
			await replaceUnitAmounts(db, contextA, id, [
				{ unitId: og.id, amount: 35000 },
				{ unitId, amount: 40000 }
			])
		).toBe('updated');
		expect(await listUnitAmounts(db, 'a', id)).toEqual([
			{ unitId, amount: 40000 },
			{ unitId: og.id, amount: 35000 }
		]);
		expect(
			await replaceUnitAmounts(db, contextA, id, [{ unitId: elsewhere.unitId, amount: 1 }])
		).toBe('unknown-unit');
		expect(await replaceUnitAmounts(db, contextA, id, [{ unitId, amount: 0 }])).toBe('updated');
		expect(await listUnitAmounts(db, 'a', id)).toEqual([]);
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'update'));
		expect(audit.map((entry) => entry.summary)).toEqual([
			'Beträge je Einheit des Belegs Grundsteuer 2025 (900,00\u00a0€) geändert',
			'Beträge je Einheit des Belegs Grundsteuer 2025 (900,00\u00a0€) geändert'
		]);
	});

	it('deletes the item with its receipt and per-unit amounts', async () => {
		const id = await create(contextA, { allocationKeyId: keyId['Beträge je Einheit'] });
		await replaceUnitAmounts(db, contextA, id, [{ unitId, amount: 50000 }]);
		const stored = await storeDocument(
			db,
			contextA,
			{
				name: 'Bescheid.pdf',
				mimeType: 'application/pdf',
				bytes: new TextEncoder().encode('%PDF-1.4'),
				links: { costItemId: id, propertyId }
			},
			{ storage }
		);
		if (!stored.ok) throw new Error('setup failed');
		expect((await getCostItem(db, 'a', id))!.receipts).toEqual([
			{ id: stored.id, name: 'Bescheid.pdf' }
		]);

		expect(await deleteCostItem(db, contextA, id, { storage })).toBe('deleted');
		expect(await getCostItem(db, 'a', id)).toBeUndefined();
		expect(await getDocument(db, 'a', stored.id)).toBeUndefined();
		expect(await db.select().from(documents)).toEqual([]);
		expect(await db.select().from(costItemUnitAmounts)).toEqual([]);
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'delete'));
		expect(audit.map((entry) => [entry.entity, entry.summary])).toEqual([
			['document', 'Dokument Bescheid.pdf gelöscht'],
			['cost_item', 'Beleg Grundsteuer 2025 (1.200,00\u00a0€) gelöscht']
		]);
	});

	it('moves its receipts along when it moves to another property', async () => {
		const other = await seedUnit(db, 'a', { propertyName: 'Anderes Haus' });
		const id = await create(contextA);
		const untouched = await create(contextA, { description: 'Bleibt' });
		const receipt = async (costItemId: string) => {
			const stored = await storeDocument(
				db,
				contextA,
				{
					name: 'Bescheid.pdf',
					mimeType: 'application/pdf',
					bytes: new TextEncoder().encode('%PDF-1.4'),
					links: { costItemId, propertyId }
				},
				{ storage }
			);
			if (!stored.ok) throw new Error('setup failed');
			return stored.id;
		};
		const moving = await receipt(id);
		const staying = await receipt(untouched);

		expect(await updateCostItem(db, contextA, id, input({ propertyId: other.propertyId }))).toEqual(
			{ ok: true }
		);
		expect(await getDocument(db, 'a', moving)).toMatchObject({
			propertyId: other.propertyId,
			costItemId: id
		});
		expect(await getDocument(db, 'a', staying)).toMatchObject({
			propertyId,
			costItemId: untouched
		});
	});

	it('drops the link to the insurance policy of the property it leaves', async () => {
		const other = await seedUnit(db, 'a', { propertyName: 'Anderes Haus' });
		const policy = await createPolicy(db, contextA, propertyId, {
			kind: 'building',
			insurer: 'Versicherung AG',
			policyNumber: null,
			annualPremium: 120000,
			renewalDate: '2026-01-01',
			noticeMonths: 3,
			endDate: null,
			note: null
		});
		if (!policy.ok) throw new Error('setup failed');
		const id = await create(contextA);
		await linkCostItemToPolicy(db, 'a', id, policy.id);
		expect(await getCostItem(db, 'a', id)).toMatchObject({ insurancePolicyId: policy.id });

		expect(await updateCostItem(db, contextA, id, input({ description: 'Neu' }))).toEqual({
			ok: true
		});
		expect(await getCostItem(db, 'a', id)).toMatchObject({ insurancePolicyId: policy.id });
		expect(await updateCostItem(db, contextA, id, input({ propertyId: other.propertyId }))).toEqual(
			{ ok: true }
		);
		expect(await getCostItem(db, 'a', id)).toMatchObject({ insurancePolicyId: null });
		expect(await integrityProblems(db)).toEqual([]);
	});

	it('goes with its property, and so does its receipt', async () => {
		const id = await create(contextA);
		const stored = await storeDocument(
			db,
			contextA,
			{
				name: 'Bescheid.pdf',
				mimeType: 'application/pdf',
				bytes: new TextEncoder().encode('%PDF-1.4'),
				links: { costItemId: id, propertyId }
			},
			{ storage }
		);
		if (!stored.ok) throw new Error('setup failed');

		expect(await deleteProperty(db, contextA, propertyId, { storage })).toBe('deleted');
		expect(await getCostItem(db, 'a', id)).toBeUndefined();
		expect(await getDocument(db, 'a', stored.id)).toBeUndefined();
	});

	it('does not leak into another account', async () => {
		await ensureDefaults(db, 'b');
		const foreignPlace = await seedUnit(db, 'b');
		const foreignCategories = Object.fromEntries(
			(await listCategories(db, 'b')).map((row) => [row.name, row.id])
		);
		const foreignKeys = Object.fromEntries(
			(await listKeys(db, 'b')).map((row) => [row.name, row.id])
		);
		const foreign = await create(contextB, {
			propertyId: foreignPlace.propertyId,
			categoryId: foreignCategories.Grundsteuer,
			allocationKeyId: foreignKeys['Beträge je Einheit']
		});
		await replaceUnitAmounts(db, contextB, foreign, [{ unitId: foreignPlace.unitId, amount: 1 }]);

		expect(await listCostItems(db, 'a')).toEqual([]);
		expect(await listCostItemYears(db, 'a')).toEqual([]);
		expect(await getCostItem(db, 'a', foreign)).toBeUndefined();
		expect(await listUnitAmounts(db, 'a', foreign)).toEqual([]);
		expect(await updateCostItem(db, contextA, foreign, input())).toEqual({
			ok: false,
			reason: 'missing'
		});
		expect(await replaceUnitAmounts(db, contextA, foreign, [])).toBe('missing');
		expect(await deleteCostItem(db, contextA, foreign, { storage })).toBe('missing');
		// The other account's category and key are unknown here, even with an own property.
		expect(
			await createCostItem(db, contextA, input({ categoryId: foreignCategories.Grundsteuer }))
		).toEqual({ ok: false, reason: 'unknown-category' });
		expect(
			await createCostItem(db, contextA, input({ allocationKeyId: foreignKeys.Wohnfläche }))
		).toEqual({ ok: false, reason: 'unknown-key' });
		expect(await getCostItem(db, 'b', foreign)).toBeDefined();
	});
});
