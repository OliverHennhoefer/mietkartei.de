import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db';
import { auditLog, costItemUnitAmounts, documents, units } from '../db/schema';
import { getDocument, storeDocument } from '../documents';
import { deleteProperty } from '../properties';
import { openFileStorage } from '../storage/fs';
import type { Storage } from '../storage';
import { contextA, contextB, seedUnit, testDatabase } from '../testing';
import { createCircle } from './circles';
import {
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
		...overrides
	};
}

async function create(context: typeof contextA, overrides: Partial<CostItemInput> = {}) {
	const result = await createCostItem(db, context, input(overrides));
	if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
	return result.id;
}

describe('cost items', () => {
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
			amount: 300000
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

	it('goes with its property; the receipt stays as a document without the links', async () => {
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

		expect(await deleteProperty(db, contextA, propertyId)).toBe('deleted');
		expect(await getCostItem(db, 'a', id)).toBeUndefined();
		expect(await getDocument(db, 'a', stored.id)).toMatchObject({
			propertyId: null,
			costItemId: null
		});
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
