import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from './db';
import { storeDocument } from './documents';
import { RECEIPTS_OVERVIEW, receiptCount, receiptPackage } from './statement-receipts';
import { createStatement, getStatement } from './statements';
import {
	contextA,
	memoryStorage,
	seedCostItem,
	seedLease,
	seedUnit,
	testDatabase
} from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-03-01T10:00:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

async function seed(storage: ReturnType<typeof memoryStorage>) {
	const { propertyId, unitId } = await seedUnit(db, 'a');
	await seedLease(db, 'a', unitId, { startDate: '2025-01-01' });
	const grundsteuer = await seedCostItem(db, 'a', propertyId, {
		description: 'Grundsteuer 2025',
		amount: 60000
	});
	const verwaltung = await seedCostItem(db, 'a', propertyId, {
		description: 'Kontoführung',
		amount: 12000,
		allocable: false
	});
	const store = async (name: string, costItemId: string, text: string) => {
		const stored = await storeDocument(
			db,
			contextA,
			{
				name,
				mimeType: 'application/pdf',
				bytes: new TextEncoder().encode(text),
				links: { propertyId, costItemId }
			},
			{ storage }
		);
		if (!stored.ok) throw new Error(stored.reason);
		return stored.id;
	};
	await store('Bescheid.pdf', grundsteuer, 'bescheid');
	await store('Änderung: Hebesatz.pdf', grundsteuer, 'aenderung');
	await store('Kontoauszug.pdf', verwaltung, 'privat');
	const created = await createStatement(db, contextA, {
		propertyId,
		periodStart: '2025-01-01',
		periodEnd: '2025-12-31'
	});
	if (!created.ok) throw new Error(created.message);
	return { statementId: created.id };
}

describe('receiptPackage', () => {
	it('packs the overview and the documents of the allocable items, numbered', async () => {
		const storage = memoryStorage();
		const { statementId } = await seed(storage);
		const view = (await getStatement(db, 'a', statementId))!;
		expect(await receiptCount(db, 'a', view.result.property.items)).toBe(2);

		const receipts = (await receiptPackage(db, 'a', statementId, { storage }))!;
		expect(receipts.filename).toBe('Belege Betriebskostenabrechnung 2025 Haus.zip');
		expect(receipts).toMatchObject({ files: 2, missing: 0 });
		const files = unzipSync(receipts.bytes);
		// The overview first; the Kontoführung is not allocable and stays out.
		expect(Object.keys(files)).toEqual([
			RECEIPTS_OVERVIEW,
			'01 Grundsteuer - Bescheid.pdf',
			'01-2 Grundsteuer - Änderung_ Hebesatz.pdf'
		]);
		expect(strFromU8(files['01 Grundsteuer - Bescheid.pdf'])).toBe('bescheid');
		expect(strFromU8(files[RECEIPTS_OVERVIEW].subarray(0, 5))).toBe('%PDF-');
	});

	it('names documents whose file is gone and answers undefined for another account', async () => {
		const storage = memoryStorage();
		const { statementId } = await seed(storage);
		const [first] = [...storage.files.keys()];
		storage.files.delete(first);
		const receipts = (await receiptPackage(db, 'a', statementId, { storage }))!;
		expect(receipts).toMatchObject({ files: 1, missing: 1 });
		expect(Object.keys(unzipSync(receipts.bytes))).toHaveLength(2);
		expect(await receiptPackage(db, 'b', statementId, { storage })).toBeUndefined();
	});

	it('finds the documents of a statement with more items than D1 binds parameters', async () => {
		const storage = memoryStorage();
		const { statementId } = await seed(storage);
		const view = (await getStatement(db, 'a', statementId))!;
		const many = [
			...Array.from({ length: 150 }, (_, index) => ({
				...view.result.property.items[0],
				itemId: `other-${index}`
			})),
			...view.result.property.items
		];
		expect(await receiptCount(db, 'a', many)).toBe(2);
	});
});
